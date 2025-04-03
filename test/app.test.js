const request = require('supertest');
const app = require('../server'); // importing app without starting the server
const { WebClient } = require('@slack/web-api');

jest.mock('@slack/web-api');

describe('Slack Bot API Tests', () => {
    let mockSlackClient;

    beforeEach(() => {
        mockSlackClient = {
            views: { open: jest.fn().mockResolvedValue({ ok: true }) },
            chat: { postMessage: jest.fn().mockResolvedValue({ ok: true }) },
            conversations: { invite: jest.fn().mockResolvedValue({ ok: true }) },
            users: { list: jest.fn().mockResolvedValue({ members: [{ id: 'U123', name: 'admin_user', is_admin: true }] }) }
        };

        WebClient.mockImplementation(() => mockSlackClient);
    });

    // home route test
    it('should return bot running message on /', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toBe('Bot is running!');
    });

    // command to open approval modal
    it('should open approval modal on /slack/command', async () => {
        const res = await request(app)
            .post('/slack/command')
            .send({ trigger_id: 'test-trigger' });

        expect(res.status).toBe(200);
    });

    // handle modal submission and notify approver
    it('should handle modal submission and notify approver', async () => {
        const res = await request(app)
            .post('/slack/interactions')
            .send({
                payload: JSON.stringify({
                    type: 'view_submission',
                    user: { id: 'U12345' },
                    view: {
                        state: {
                            values: {
                                approver_select: { approver: { selected_option: { value: 'U67890' } } },
                                approval_reason: { text: { value: 'Need access to project' } }
                            }
                        }
                    }
                })
            });

        expect(res.status).toBe(200);
    });

    // test for approval case
    it('should approve request and add user to hidden channel', async () => {
        const res = await request(app)
            .post('/slack/interactions')
            .send({
                payload: JSON.stringify({
                    type: 'interactive_message',
                    callback_id: 'request_123',
                    actions: [{ value: 'approved' }],
                    user: { id: 'U67890' },
                    channel: { id: 'C123' },
                    message_ts: '1618888888.000200'
                })
            });

        expect(res.status).toBe(200);
    });

    // test for rejection case
    it('should reject request and notify requester', async () => {
        const res = await request(app)
            .post('/slack/interactions')
            .send({
                payload: JSON.stringify({
                    type: 'interactive_message',
                    callback_id: 'request_123',
                    actions: [{ value: 'rejected' }],
                    user: { id: 'U67890' },
                    channel: { id: 'C123' },
                    message_ts: '1618888888.000200'
                })
            });

        expect(res.status).toBe(200);
    });
});