require('dotenv').config({ path: '.env.local' }); // load environment variables from .env.local file for now

const express = require('express');
const { WebClient } = require('@slack/web-api');
const bodyParser = require('body-parser'); // for parsing slack api data

const app = express();
const PORT = process.env.PORT || 3000;

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN); // initialize slack api
const pendingRequests = {}; // initialise pendingRequests object to store requests later

// middlewares
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(bodyParser.json()); // for parsing application/json

// fetch usrs for dropdown
async function getSlackUsers() {
    const response = await slackClient.users.list(); // get list of users

    // return array of users (for including in the modal dropdown)
    return response.members
        .filter(user => !user.is_bot && user.id !== 'USLACKBOT' && !user.name.startsWith('deactivateduser') && user.is_admin) // filter out bots and deactivated users and only show the admins in the dropdows
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

        res.send(''); // send empty response to acknowledge the command
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

        // store requester info so we can notify later
        const requestId = `request_${Date.now()}`; // unique id for the request
        pendingRequests[requestId] = { requester, approvalText };

        // message to approver for action
        await slackClient.chat.postMessage({
            channel: approver, // dm to the approver via ApprovalBot app
            text: `New approval request from <@${requester}>: ${approvalText}`,
            // ui for the approval message
            attachments: [
                {
                    text: 'Do you approve?',
                    fallback: 'You must approve or reject',
                    callback_id: requestId, // use the request id as callback id so we can identify the request later (wasted like 30 mins on this)
                    actions: [
                        { name: 'approve', text: 'Approve', type: 'button', value: 'approved' },
                        { name: 'reject', text: 'Reject', type: 'button', value: 'rejected' }
                    ]
                }
            ]
        });

        res.json({ response_action: 'clear' }); // send response to clear the modal

    } else if (payload.type === 'interactive_message') { // Handle button clicks 
        const requestId = payload.callback_id; // get id of the interaction
        const action = payload.actions[0].value; // get the value of the interaction
        const approver = payload.user.id; // get the user id of the approver

        // handle expired or invalid requests
        if (!pendingRequests[requestId]) {
            return res.send('Request not found or already processed.');
        }

        const { requester, approvalText } = pendingRequests[requestId]; // get the requester info which we stored earlier

        // this is what the approver sees after accepting or rejecting
        let responseText = action === 'approved'
            ? `*Approved* by <@${approver}>`
            : `*Rejected* by <@${approver}>`;

        // notify the requester
        await slackClient.chat.postMessage({
            channel: requester, // dm to the requester
            text: `Your approval request *"${approvalText}"* has been ${responseText}`
        });

        // confirm action to approver by updating the message
        await slackClient.chat.update({
            channel: payload.channel.id, // same channel as the original message (approver dm)
            ts: payload.message_ts, // message timestamp
            text: `Approval request from <@${requester}>: *${approvalText}*`,
            attachments: [{ text: responseText }]
        });

        delete pendingRequests[requestId]; // Remove request from memory
        res.send(''); // send empty response to acknowledge the action
    }
});

// start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
