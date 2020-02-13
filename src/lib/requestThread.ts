import {SlackMessageId} from "./slackMessageId";
import {logger} from "..";
import {NexusModuleConfig} from "@nexus-switchboard/nexus-extend";
import {RequestState} from "./request";
import {JiraTicket} from "@nexus-switchboard/nexus-conn-jira";
import {SlackBlock, SlackConnection} from "@nexus-switchboard/nexus-conn-slack";


export const claimButton: IssueAction = {
    code: "claim_request",
    name: "Claim",
    style: "primary"
};

export const cancelButton: IssueAction = {
    code: "cancel_request",
    name: "Cancel",
    style: "danger"
};

export const completeButton: IssueAction = {
    code: "complete_request",
    name: "Complete",
    style: "primary"
};

export const viewButton: IssueAction = {
    code: "view_request",
    name: "View Ticket",
    style: "primary",
    url: undefined
};


export type IssueAction = {
    code: string,
    name: string,
    style?: "primary" | "danger",
    url?: string
};

export class RequestThread {

    public slackMessageId: SlackMessageId;
    protected ticket: JiraTicket;
    protected slack: SlackConnection;
    protected config: NexusModuleConfig;

    constructor(ts: string, channel: string, slack: SlackConnection, config: NexusModuleConfig) {
        this.slackMessageId = new SlackMessageId(channel, ts);
        this.slack = slack;
        this.config = config;
    }

    public get channel(): string {
        return this.slackMessageId.channel;
    }

    public get ts(): string {
        return this.slackMessageId.ts;
    }

    public serializeId(): string {
        return this.slackMessageId.buildRequestId();
    }

    public async getTopLevelMessageId() {
        return this.slackMessageId;
    }

    public async getThreadHeaderMessageId(): Promise<SlackMessageId> {
        if (!this.slackMessageId.ts) {
            throw new Error("You cannot find a status reply without an existing source thread");
        }

        try {
            const messages = await this.slack.getChannelThread(this.slackMessageId.channel,
                this.slackMessageId.ts);

            // pull only the messages that belong to the bot.
            const botMessages = messages.filter((m) => m.hasOwnProperty("username") &&
                m.username.toLowerCase() === this.config.SLACK_BOT_USERNAME.toLowerCase());

            // the first one will be the originating message which should always be the bots.
            if (botMessages.length > 1) {
                return new SlackMessageId(this.slackMessageId.channel, botMessages[1].ts)
            } else {
                return undefined;
            }

        } catch (e) {
            logger("Exception thrown: Unable to find status reply message due to this error: " + e.toString());
            return undefined;
        }
    }


    public buildTextBlocks(ticket: JiraTicket, state: RequestState, ticketLink?: string, msg?: string, slackUserId?: string): SlackBlock[] {

        const header = this.getMessageText(ticket, state, ticketLink, msg, slackUserId);

        return [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: header
                }
            }
        ]
    }

    public static buildActionBarHeader(): SlackBlock[] {
        return [{
            type: "section",
            text: {
                type: 'mrkdwn',
                text: "*Ticket Actions*"
            }
        }];
    }
    public buildActionBlocks(state: RequestState, ticket?: JiraTicket, jiraLink?: string) {
        const actions = RequestThread.getMessageActions(state, ticket, jiraLink);

        const blocks: SlackBlock[] = RequestThread.buildActionBarHeader();

        if (actions.length > 0) {
            blocks.push({
                type: "actions",
                block_id: "infra_request_actions",
                elements: actions.map((a) => {
                    return {
                        type: "button",
                        text: {
                            type: "plain_text",
                            emoji: true,
                            text: a.name,
                        },
                        style: a.style,
                        value: a.code,
                        url: a.url ? a.url : undefined
                    };
                })
            });
        } else {
            blocks.push({
                type: "section",
                text: {
                    type: 'mrkdwn',
                    text: `${this.config.REQUEST_WORKING_SLACK_ICON} Waiting...`
                }
            })
        }
        return blocks;
    }

    private iconFromState(state: RequestState): string {

        const statusToIconMap: Record<RequestState, string> = {
            [RequestState.working]: this.config.REQUEST_WORKING_SLACK_ICON || ":clock1:",
            [RequestState.error]: this.config.REQUEST_ERROR_SLACK_ICON || ":x:",
            [RequestState.complete]: this.config.REQUEST_COMPLETED_SLACK_ICON || ":white_circle:",
            [RequestState.todo]: this.config.REQUEST_SUBMITTED_SLACK_ICON || ":black_circle:",
            [RequestState.cancelled]: this.config.REQUEST_CANCELLED_SLACK_ICON || ":red_circle:",
            [RequestState.claimed]: this.config.REQUEST_CLAIMED_SLACK_ICON || ":large_blue_circle:",
            [RequestState.unknown]: ":red_circle"
        };

        return state in statusToIconMap ? statusToIconMap[state] : ":question:";
    }

    /**
     * Used to render the right action buttons in a message based on issue properties.
     */
    private static getMessageActions(state: RequestState, _ticket?: JiraTicket, jiraLink?: string): IssueAction[] {
        const newViewButton = Object.assign({}, viewButton);
        newViewButton.url = jiraLink;

        if (state === RequestState.complete || state === RequestState.cancelled) {
            return [newViewButton]
        } else if (state === RequestState.todo) {
            return [claimButton, cancelButton, newViewButton]
        } else if (state === RequestState.claimed) {
            return [completeButton, cancelButton, newViewButton]
        } else if (state === RequestState.working) {
            return []
        } else if (state === RequestState.error) {
            return []
        } else {
            // if we don't know the state then we should show all the buttons.
            return [claimButton, completeButton, cancelButton, newViewButton]
        }
    };

    public getMessageText(ticket: JiraTicket, state: RequestState, jiraLink?: string, msg?: string, slackUserId?: string): string {

        let statusLine: string;
        const icon = this.iconFromState(state);

        if (state === RequestState.todo) {
            statusLine = `${icon} Issue submitted by <@${slackUserId}>`;
        } else if (state === RequestState.claimed) {
            statusLine = `${icon} Issue claimed by <@${slackUserId}>`;
        } else if (state === RequestState.complete) {
            statusLine = `${icon} Issue completed by <@${slackUserId}>`;
        } else if (state === RequestState.cancelled) {
            statusLine = `${icon} Issue cancelled by <@${slackUserId}>`;
        } else if (state === RequestState.error) {
            statusLine = `${icon} ${msg ? msg : "Ummm... there was a problem"}}`;
        } else if (state === RequestState.working) {
            statusLine = `${icon} ${msg || "Working..."}`;
            msg = "";
        }

        let messageLine = "";

        if (msg) {
            messageLine = `*${msg}*`;
        } else if (ticket && jiraLink) {
            messageLine = `*<${jiraLink}|${ticket.key} - ${ticket.fields.summary}>*`
        } else if (ticket) {
            messageLine = `*${ticket.key} - ${ticket.fields.summary}*`
        }

        // only add both lines if the second line has been set (could be empty if there was not ticket given)
        return (messageLine ? `${messageLine}\n` : "") + statusLine;
    };
}
