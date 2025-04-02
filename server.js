require('dotenv').config({ path: '.env.local' }); // load environment variables from .env.local file for now
const express = require('express');
const bodyParser = require('body-parser'); // for parsing slack api data

const { WebClient } = require('@slack/web-api');

const app = express();
const PORT = process.env.PORT || 3000;

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN); // initialize slack api

// middlewares
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(bodyParser.json()); // for parsing application/json

// home route
app.get('/', (req, res) => {
    res.send('Bot is running!');
});

// command endpoint for slash command [/approval-test]
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

// handle modal submission
app.post('/slack/interactions', async (req, res) => {
    // get payload details
    const payload = JSON.parse(req.body.payload);

    if (payload.type === 'view_submission') {
        const approvalText = payload.view.state.values.approval_reason.text.value; // extract the approval reason from the modal submission

        console.log('Approval Request Submitted:', approvalText); // log the approval reason
        res.json({ response_action: 'clear' }); // clears the modal after submission
    }
});

// start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
