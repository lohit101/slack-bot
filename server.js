require('dotenv').config({ path: '.env.local' }); // load environment variables from .env.local file for now
const express = require('express');
const bodyParser = require('body-parser'); // for parsing slack api data

const { WebClient } = require('@slack/web-api');

const app = express();
const PORT = process.env.PORT || 3000;

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN); // initialize slack api

app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(bodyParser.json()); // for parsing application/json

// middleware
app.use(express.json());

// test route
app.get('/', (req, res) => {
    res.send('Bot is running!');
});

// command endpoint for testing
app.post('/slack/command', async (req, res) => {
    // get trigger id for opening modal
    const trigger_id = req.body.trigger_id;

    // open modal with trigger id
    try {
        await slackClient.views.open({
            trigger_id, // requires this param to open the modal according to the docs
            // simple ui for slack modal
            view: {
                type: 'modal',
                callback_id: 'approval_modal',
                title: {
                    type: 'plain_text',
                    text: 'Approval Request'
                },
                blocks: [
                    {
                        type: 'input',
                        block_id: 'approval_reason',
                        label: { type: 'plain_text', text: 'Approval Reason' },
                        element: { type: 'plain_text_input', action_id: 'text' }
                    }
                ],
                submit: { type: 'plain_text', text: 'Submit' }
            }
        });

        res.send('');
    } catch (error) {
        console.error('Error opening modal:', error);
        res.status(500).send('Error opening modal'); // log and respond with error
    }
});

// start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
