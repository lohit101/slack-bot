// require('dotenv').config({ path: '.env.local' }); // use this if you are running locally
require('dotenv').config(); // use this if you are running in production

const express = require('express');
const { WebClient } = require('@slack/web-api');
const bodyParser = require('body-parser'); // for parsing slack api data

const app = express();
const PORT = process.env.PORT || 3000; // default to port 3000 if not specified in env
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN); // initialize slack api

const pendingRequests = {}; // initialise pendingRequests object to store requests later

// middlewares
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(bodyParser.json()); // for parsing application/json

// fetch admin usrs for dropdown
async function getAdminUsers() {
    try {
        const response = await slackClient.users.list(); // get list of users

        // return array of users (for including in the modal dropdown)
        return response.members
            .filter(user => !user.is_bot && user.is_admin) // filter out bots and deactivated users and only show the admins in the dropdows
            .map(user => ({ text: { type: 'plain_text', text: user.name }, value: user.id })); // map to required format
    } catch (error) {
        console.error('Error fetching users:', error); // handle error properly
        return [];
    }
}

// home route
app.get('/', (req, res) => {
    return res.status(200).send('Bot is running!');
});

// command endpoint for slash command [/approval-test]
app.post('/slack/command', async (req, res) => {
    // open modal with trigger id
    try {
        const trigger_id = req.body.trigger_id; // get trigger id for opening modal
        const users = await getAdminUsers(); // get list of users for dropdown

        // handle invalid trigger id
        if (!trigger_id) {
            return res.status(400).send('Invalid trigger ID');
        }

        // handle empty user list
        if (!users || users.length === 0) {
            return res.status(400).send('No approvers found');
        }

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

        return res.status(200).send(); // send empty response to acknowledge the command
    } catch (error) {
        console.error('Error opening modal:', error);
        return res.status(500).send('Error opening modal'); // log and respond with error
    }
});

// handle modal submission
app.post('/slack/interactions', async (req, res) => {
    try {
        // get payload details
        const payload = JSON.parse(req.body?.payload || "{}"); // parse the payload from the request body

        // handle invalid payload
        if (!payload) {
            return res.status(400).send('Invalid payload');
        }

        if (payload.type === 'view_submission') {
            const approver = payload.view.state.values.approver_select.approver.selected_option.value; // get the approver id from the modal
            const approvalText = payload.view.state.values.approval_reason.text.value; // get the approval reason from the modal
            const requester = payload.user.id; // get user id of the person who submitted the modal

            // check if approver is valid and not the same as requester
            if (!approver || !approvalText || !requester || approver === requester) {
                return res.status(400).send('Invalid approver/requester or approval text missing.'); // handle invalid approver, requester or approval text
            }

            // store requester info so we can notify later
            const requestId = `request_${Date.now()}`; // unique id for the request
            pendingRequests[requestId] = { requester, approvalText };

            try {
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

                return res.status(200).json({ response_action: 'clear' }); // send response to clear the modal
            } catch (error) {
                console.error('Error sending message to approver:', error);
                return res.status(500).send('Error sending message to approver'); // log and respond with error
            }

        } else if (payload.type === 'interactive_message') { // Handle button clicks 
            const { callback_id: requestId, actions, user, channel, message_ts } = payload;
            const action = payload.actions[0].value; // get the value of the interaction

            if (!action || !requestId) {
                return res.status(400).send('Invalid action or request ID'); // handle invalid action or request id
            }

            // handle expired or invalid requests
            if (!pendingRequests[requestId]) {
                return res.status(400).send('Request not found or already processed.');
            }

            const { requester, approvalText } = pendingRequests[requestId]; // get the requester info which we stored earlier

            let responseText = action === 'approved' ? `*Approved* by <@${user.id}>` : `*Rejected* by <@${user.id}>`; // this is what the approver sees after accepting or rejecting

            // APPROVAL LOGIC HERE:
            // add more code ehre to handle the approval logic according to your needs
            // for this application i am just adding the approved user to a hidden channel and notifying the users

            // check if the action is approved or rejected
            if (action === 'approved') {
                // invite the approved user to the hidden channel
                try {
                    await slackClient.conversations.invite({
                        channel: process.env.HIDDEN_CHANNEL_ID, // channel ID in which the approved user gets added
                        users: requester // user requesting for approval
                    });

                    // using promise all to send both messages in parallel since they are
                    // independent of each other and do not require each other to be completed first

                    // notify the requester and update the message to the approver
                    await Promise.all([
                        // notify the requester
                        await slackClient.chat.postMessage({
                            channel: requester, // dm to the requester
                            text: `Your approval request *"${approvalText}"* has been ${responseText}`
                        }),
                        // confirm action to approver by updating the message
                        await slackClient.chat.update({
                            channel: payload.channel.id, // same channel as the original message (approver dm)
                            ts: payload.message_ts, // message timestamp
                            text: `Approval request from <@${requester}>: *${approvalText}*`,
                            attachments: [{ text: responseText }]
                        }),
                    ])

                    delete pendingRequests[requestId]; // Remove request from memory
                    return res.status(200).send(); // send empty response to acknowledge the action
                } catch (error) {
                    console.error(`Error adding user to hidden channel:`, error); // log errors to console
                }
            }
        }
    } catch (error) {
        console.error('Error processing interaction:', error);
        return res.status(500).send('Error processing interaction'); // log and respond with error
    }
});

// export app and other functions for testing
module.exports = { app, getAdminUsers, pendingRequests };

// start server only if not in test mode
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}
