require('dotenv').config();
const express = require('express');

const { WebClient } = require('@slack/web-api');

const app = express();
const PORT = process.env.PORT || 3000;

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN); // initialize slack api

// middleware
app.use(express.json());

// test route
app.get('/', (req, res) => {
    res.send('Bot is running!');
});

// command endpoint for testing
app.post('/slack/command', async (req, res) => {
    console.log('Command received:', req.body); // console logging command for debugging (if required)

    res.json({
        response_type: 'ephemeral', // ephemeral - i think only visible to the user who called the command
        text: 'Approval request received!',
    });
});

// start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
