const http = require('http');
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

// Bot setup
const bot = new Telegraf('7504626124:AAGALIAYkeyOvflFUnUPZkLksVLLy4NGPl0');  // Replace with your bot token

// Password setup
const botPassword = '1234567890';  // Set a password here

// In-memory user authentication
const authenticatedUsers = {};

// File path for storing data
const dataFilePath = path.join(__dirname, 'publicUploads.json');

// Load data from file if it exists
let publicUploads = {};
if (fs.existsSync(dataFilePath)) {
    publicUploads = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
}

// Temporary storage for user upload sessions
const uploadStates = {};

// Middleware to check if the user is authenticated
const checkAuthentication = (ctx, next) => {
    const userId = ctx.from.id;
    
    if (authenticatedUsers[userId]) {
        return next();  // User is authenticated, proceed with the next handler
    }

    ctx.reply('Please enter the password to use the bot:');
    uploadStates[userId] = { step: 'waiting_for_password' };
};

// Command: /welcome
bot.command('welcome', checkAuthentication, (ctx) => {
    const userName = ctx.from.first_name || 'there';
    ctx.reply(`Hii there ${userName}!`);
});

// Command: /upload
bot.command('upload', checkAuthentication, (ctx) => {
    const userId = ctx.from.id;
    ctx.reply('Please enter a small description of the media you are about to send:');
    
    // Set user state to wait for description
    uploadStates[userId] = { step: 'waiting_for_description' };
});

// Command: /fetch
bot.command('fetch', checkAuthentication, (ctx) => {
    if (Object.keys(publicUploads).length === 0) {
        ctx.reply('No media descriptions available.');
        return;
    }

    // Provide a list of unique descriptions to the user
    const options = Object.keys(publicUploads).map((description, index) => ({
        text: description,
        callback_data: String(index),  // Use the index as callback data
    }));

    ctx.reply(
        'Please choose a description to fetch the media:',
        Markup.inlineKeyboard(options.map(o => [Markup.button.callback(o.text, o.callback_data)]))
    );
});

// Handle incoming messages
bot.on('message', (ctx) => {
    const userId = ctx.from.id;
    const userState = uploadStates[userId];

    // Password validation
    if (userState && userState.step === 'waiting_for_password') {
        if (ctx.message.text === botPassword) {
            // If the password is correct, authenticate the user
            authenticatedUsers[userId] = true;
            delete uploadStates[userId];  // Clear the password state
            ctx.reply('You have been authenticated! Now you can use the bot.');
        } else {
            // If the password is incorrect, ask again
            ctx.reply('Incorrect password. Please try again.');
        }
        return;
    }

    // If the user is in the media upload step
    if (userState && userState.step === 'waiting_for_description') {
        // Store the description and ask for media
        const description = ctx.message.text;
        uploadStates[userId] = { step: 'waiting_for_media', description, firstMedia: true };
        ctx.reply('Thanks! Now send the media. You can send multiple files if needed. Don\'t forget to type /done when finished.');

    } else if (userState && userState.step === 'waiting_for_media') {
        if (ctx.message.photo || ctx.message.document || ctx.message.video) {
            // Store the media under the given description in the public storage
            const mediaMessage = ctx.message;
            const description = userState.description;

            if (!publicUploads[description]) {
                publicUploads[description] = [];
            }
            
            publicUploads[description].push(mediaMessage);

            // Forward the media to the group (replace 'YOUR_GROUP_ID' with the actual group ID)
            const groupId = '-4553230287';  // Replace with your group ID
            ctx.telegram.forwardMessage(groupId, ctx.chat.id, mediaMessage.message_id);

            // Confirm to the user if this is the first media of the session
            if (userState.firstMedia) {
                ctx.reply('Media received successfully. Send more files or type /done when finished.');
                userState.firstMedia = false;  // Clear the flag after sending the message
            }

        } else if (ctx.message.text === '/done') {
            // If user sends /done, finish the upload session
            ctx.reply('Your media upload session is finished.');
            delete uploadStates[userId];
        }

    } else {
        // If the user sends a message not during upload or fetch, remind them of the available commands
        ctx.reply('Please use one of the available commands: /welcome, /upload, or /fetch.');
    }

    // Save data to file after processing each message
    fs.writeFileSync(dataFilePath, JSON.stringify(publicUploads, null, 2), 'utf8');
});

// Handle media fetching after user selects a prompt
bot.on('callback_query', (callbackCtx) => {
    const index = parseInt(callbackCtx.callbackQuery.data);
    const description = Object.keys(publicUploads)[index];

    if (publicUploads[description] && publicUploads[description].length > 0) {
        const mediaList = publicUploads[description];

        // Send all media files under the selected description
        mediaList.forEach((mediaMessage) => {
            if (mediaMessage.photo) {
                callbackCtx.telegram.sendPhoto(callbackCtx.from.id, mediaMessage.photo[mediaMessage.photo.length - 1].file_id);
            } else if (mediaMessage.document) {
                callbackCtx.telegram.sendDocument(callbackCtx.from.id, mediaMessage.document.file_id);
            } else if (mediaMessage.video) {
                callbackCtx.telegram.sendVideo(callbackCtx.from.id, mediaMessage.video.file_id);
            }
        });

        // Acknowledge the callback query
        callbackCtx.answerCbQuery('Here is your media.');
    } else {
        callbackCtx.answerCbQuery('Could not find the media.', { show_alert: true });
    }
});

// Start the bot
bot.launch();

// Handle graceful stop
process.once('SIGINT', () => {
    // Save data to file on bot stop
    fs.writeFileSync(dataFilePath, JSON.stringify(publicUploads, null, 2), 'utf8');
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    // Save data to file on bot stop
    fs.writeFileSync(dataFilePath, JSON.stringify(publicUploads, null, 2), 'utf8');
    bot.stop('SIGTERM');
});

// HTTP server setup
const hostname = '0.0.0.0';
const port = 8000;

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Hello World\n');
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});

// Handle graceful shutdown for the server
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});
