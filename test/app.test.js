const request = require("supertest");
const { app, getAdminUsers, pendingRequests } = require("../server");
const { WebClient } = require("@slack/web-api");

jest.mock("@slack/web-api", () => ({
    WebClient: jest.fn(() => ({
        users: {
            list: jest.fn().mockResolvedValue({
                members: [
                    { id: "U123", name: "Admin User", is_admin: true, is_bot: false },
                    { id: "U456", name: "Regular User", is_admin: false, is_bot: false }
                ]
            })
        },
        views: { open: jest.fn().mockResolvedValue({}) },
        chat: { postMessage: jest.fn().mockResolvedValue({}) },
    })),
}));

jest.setTimeout(10000);

describe("Slack Bot API Tests", () => {
    it("should return 200 for home route", async () => {
        const res = await request(app).get("/");
        expect(res.status).toBe(200);
    });

    it("should fetch admin users and return them correctly", async () => {
        const users = await getAdminUsers();
        expect(users).toEqual([
            { text: { type: "plain_text", text: "Admin User" }, value: "U123" }
        ]);
    });

    it("should return 400 if trigger_id is missing in /slack/command", async () => {
        const res = await request(app).post("/slack/command").send({});
        expect(res.status).toBe(400);
    });

    it("should return 400 if no admin users are found", async () => {
        jest.spyOn(WebClient.prototype.users, "list").mockResolvedValueOnce({
            members: [{ id: "U456", name: "Regular User", is_admin: false, is_bot: false }]
        });

        const users = await getAdminUsers();
        expect(users).toEqual([]);

        jest.restoreAllMocks();
    });

    it("should open a Slack modal on valid /slack/command request", async () => {
        const res = await request(app).post("/slack/command").send({ trigger_id: "test-trigger" });
        expect(res.status).toBe(200);
    });

    it("should return 400 for invalid modal submission payload", async () => {
        const res = await request(app).post("/slack/interactions").send({
            payload: JSON.stringify({ type: "view_submission", view: {} })
        });
        expect(res.status).toBe(400);
    });

    it("should handle a valid modal submission and notify the approver", async () => {
        const res = await request(app).post("/slack/interactions").send({
            payload: JSON.stringify({
                type: "view_submission",
                view: {
                    state: {
                        values: {
                            approver: { selected_user: "U123" },
                            requester: { selected_user: "U456" }
                        }
                    }
                }
            })
        });

        expect(res.status).toBe(200);
        expect(WebClient.prototype.chat.postMessage).toHaveBeenCalled();
    });

    it("should return 400 if approver and requester are the same", async () => {
        const res = await request(app).post("/slack/interactions").send({
            payload: JSON.stringify({
                type: "view_submission",
                view: {
                    state: {
                        values: {
                            approver: { selected_user: "U123" },
                            requester: { selected_user: "U123" }
                        }
                    }
                }
            })
        });
        expect(res.status).toBe(400);
    });

    it("should handle interactive message actions (approval/rejection)", async () => {
        pendingRequests["request_123"] = { requester: "U456", approvalText: "Test Approval" };

        const res = await request(app).post("/slack/interactions").send({
            payload: JSON.stringify({
                type: "interactive_message",
                actions: [{ value: "approve_request_123" }]
            })
        });

        expect(res.status).toBe(200);
    });

    it("should return 400 for invalid action in interactive messages", async () => {
        const res = await request(app).post("/slack/interactions").send({
            payload: JSON.stringify({ type: "interactive_message", actions: [{ value: "invalid_action" }] })
        });

        expect(res.status).toBe(400);
    });

    it("should return 400 if request is not found in interactive messages", async () => {
        const res = await request(app).post("/slack/interactions").send({
            payload: JSON.stringify({ type: "interactive_message", actions: [{ value: "approve_request_999" }] })
        });

        expect(res.status).toBe(400);
    });
});
