import {SlackMessageId} from "./slackMessageId";
import {logger} from "..";
import {getNestedVal, NexusModuleConfig} from "@nexus-switchboard/nexus-extend";
import {RequestState} from "./request";
import {JiraTicket} from "@nexus-switchboard/nexus-conn-jira";
import {SlackConnection, SlackPayload} from "@nexus-switchboard/nexus-conn-slack";


export interface ITopLevelMessageInput {
    status: string,
    jiraTicket?: JiraTicket,
    slackUserId?: string,
    message?: string,
    errorMsg?: string
}

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


export type IssueAction = {
    code: string,
    name: string,
    style?: "primary" | "danger"
};

export class RequestThread {

    public slackMessageId: SlackMessageId;
    protected ticket: JiraTicket;
    protected slack: SlackConnection;
    protected config: NexusModuleConfig;

    constructor(ts: string, channel: string, slack: SlackConnection, config: NexusModuleConfig) {
        this.slackMessageId.ts = ts;
        this.slackMessageId.channel = channel;
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

            if (messages.length > 1) {
                return new SlackMessageId(messages[1].channel, messages[1].ts)
            } else {
                return undefined;
            }

        } catch (e) {
            logger("Unable to find status reply message due to this error: " + e.toString());
            return undefined;
        }
    }


    protected buildTextBlocks(ticket: JiraTicket, state: RequestState, ticketLink: string): SlackPayload[] {

        const header = this.getMessageText(ticket, state, ticketLink);

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

    public buildActionBlocks(state: RequestState) {
        const actions = RequestThread.getMessageActions(state);

        return [{
                type: "actions",
                block_id: "infra_request_actions",
                elements: actions.map((a) => {
                    return {
                        type: "button",
                        text: {
                            type: "plain_text",
                            emoji: true,
                            text: a.name
                        },
                        style: a.style,
                        value: a.code
                    };
                })
            }
        ]
    }

    private iconFromState(state: RequestState): string {

        const statusToIconMap: Record<RequestState,string> = {
            [RequestState.working]: this.config.REQUEST_COMMS_SLACK_ICON || ":clock1:",
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
    private static getMessageActions(state: RequestState): IssueAction[] {
        if (state === RequestState.complete || state === RequestState.cancelled) {
            return []
        } else if (state === RequestState.todo) {
            return [claimButton, cancelButton]
        } else if (state === RequestState.claimed) {
            return [completeButton, cancelButton]
        } else {
            // if we don't know the state then we should show all the buttons.
            return [claimButton, completeButton, cancelButton]
        }
    };

    public getMessageText(ticket: JiraTicket, state: RequestState, jiraLink?: string, msg?: string): string {

        let firstLine: string;
        const icon = this.iconFromState(state);

        if (state === RequestState.todo) {
            const name = getNestedVal(ticket, "fields.reporter.displayName") || "?";
            firstLine = `${icon} Issue submitted by <@${name}>`;
        } else if (state === RequestState.claimed) {
            const name = getNestedVal(ticket, "fields.assignee.displayName") || "?";
            firstLine = `${icon} Issue claimed by <@${name}>`;
        } else if (state === RequestState.complete) {
            const name = getNestedVal(ticket, "fields.assignee.displayName") || "?";
            firstLine = `${icon} Issue completed by <@${name}>`;
        } else if (state === RequestState.cancelled) {
            const name = getNestedVal(ticket, "fields.assignee.displayName") || "?";
            firstLine = `${icon} Issue cancelled by <@${name}>`;
        } else if (state === RequestState.error) {
            firstLine = `${icon} ${msg ? msg : "Ummm... there was a problem"}}`;
        }

        let secondLine = "";

        if (msg) {
            secondLine = `*msg*`;
        } else if (this.ticket && jiraLink) {
            secondLine = `*<${jiraLink}|${ticket.key} - ${ticket.fields.summary}>*`
        } else if (this.ticket) {
            secondLine = `*${ticket.key} - ${ticket.fields.summary}*`
        }

        // only add both lines if the second line has been set (could be empty if there was not ticket given)
        return firstLine + (secondLine ? `\n${secondLine}` : "");
    };
}
