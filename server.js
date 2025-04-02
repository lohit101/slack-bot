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

// fetch usrs for dropdown
async function getSlackUsers() {
    const response = await slackClient.users.list(); // get list of users

    // return array of users (for including in the modal dropdown)
    return response.members
        .filter(user => !user.is_bot && user.id !== 'USLACKBOT') // filter out bots
        .map(user => ({ text: { type: 'plain_text', text: user.name }, value: user.id })); // map to required format
}

// home route
app.get('/', (req, res) => {
    res.send('Bot is running!');
});

// command endpoint for slash command [/approval-test]
app.post('/slack/command', async (req, res) => {
    const trigger_id = req.body.trigger_id; // get trigger id for opening modal
    const users = await getSlackUsers(); // get list of users for dropdown

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
                        block_id: 'approver_select',
                        label: { type: 'plain_text', text: 'Select Approver' },
                        element: { type: 'static_select', action_id: 'approver', options: users } // pass filtered users to the modal dropdown
                    },
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
        const approver = payload.view.state.values.approver_select.approver.selected_option.value; // get the approver id from the modal
        const approvalText = payload.view.state.values.approval_reason.text.value; // get the approval reason from the modal
        const requester = payload.user.id; // get user id of the person who submitted the modal

        // message to approver for action
        await slackClient.chat.postMessage({
            channel: approver, // dm to the approver via ApprovalBot app
            text: `New approval request from <@${requester}>: ${approvalText}`,
            // ui for the approval message
            attachments: [
                {
                    text: 'Do you approve?',
                    fallback: 'You must approve or reject',
                    callback_id: 'approval_action',
                    actions: [
                        { name: 'approve', text: 'Approve', type: 'button', value: 'approved' },
                        { name: 'reject', text: 'Reject', type: 'button', value: 'rejected' }
                    ]
                }
            ]
        });

        res.json({ response_action: 'clear' });
    }
});

// start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
