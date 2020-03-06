import { SlackMessageId } from "./slackMessageId";
import { logger } from "..";
import { getNestedVal, ModuleConfig } from "@nexus-switchboard/nexus-extend";
import { RequestState } from "./request";
import { JiraTicket, JiraConnection } from "@nexus-switchboard/nexus-conn-jira";
import { SlackBlock, SlackConnection } from "@nexus-switchboard/nexus-conn-slack";
import { replaceAll } from "./util";
import assert from "assert";

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

export type JiraIssueSidecarData = {
    issueIdOrKey?: string,
    propertyKey?: string,
    channelId: string,
    threadId: string,
    actionMsgId: string,
    reporterSlackId: string
};

export class RequestThread {

    public slackMessageId: SlackMessageId;
    public actionMessageId: SlackMessageId;

    protected _reporterSlackId: string;
    protected _ticket: JiraTicket;
    protected slack: SlackConnection;
    protected jira: JiraConnection;
    protected config: ModuleConfig;

    constructor(ts: string, channel: string, slack: SlackConnection, jira: JiraConnection, config: ModuleConfig) {
        this.slackMessageId = new SlackMessageId(channel, ts);
        this.slack = slack;
        this.jira = jira;
        this.config = config;
    }

    public get ticket(): JiraTicket {
        return this._ticket;
    }

    public set ticket(val: JiraTicket) {
        this._ticket = val;
    }

    public get reporterSlackId(): string {
        return this._reporterSlackId;
    }

    public set reporterSlackId(val: string) {
        this._reporterSlackId = val;
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

    public async setActionThread(ts: string) {
        if (!this.actionMessageId) {
            this.actionMessageId = new SlackMessageId(this.slackMessageId.channel, ts);
        } else {
            this.actionMessageId.ts = ts;
        }

        await this.saveJiraIssueProperties();
    }

    /**
     * This will save the infrabot properties on the  associated jira ticket (in  Jira).  This includes
     * the action message ID and the originating slack user.
     */
    protected async saveJiraIssueProperties() {
        if (!this.ticket) {
            return;
        }

        try {
            await this.jira.api.issueProperties.setIssueProperty({
                issueIdOrKey: this.ticket.key,
                propertyKey: "infrabot",
                channelId: this.slackMessageId.channel,
                threadId: this.slackMessageId.ts,
                actionMsgId: this.actionMessageId.ts,
                reporterSlackId: this.reporterSlackId
            });
        } catch (e) {
            logger("Exception thrown: Unable to set issue property data on an issue: " + e.toString());
        }
    }

    /**
     * This will load the infrabot properties associated  with the jira ticket (in  Jira).  This includes
     * the action message ID and the originating slack user.
     */
    public async loadJiraIssueProperties(): Promise<any> {
        if (!this.ticket) {
            return undefined;
        }

        try {
            let props: JiraIssueSidecarData = getNestedVal(this.ticket, "properties.infrabot");
            if (!props) {
                const result = await this.jira.api.issueProperties.getIssueProperty({
                    issueIdOrKey: this.ticket.key,
                    propertyKey: "infrabot"
                });

                if (result) {
                    props = result.value;
                }
            }

            if (props) {
                assert(props.channelId === this.channel);
                this.actionMessageId = new SlackMessageId(this.channel, props.actionMsgId);
                this.reporterSlackId = props.reporterSlackId;
            } else {
                logger("There was no valid infrabot property found on issue " + this.ticket.key);
            }
        } catch (e) {
            logger("Exception thrown: Unable to get issue property data on an issue: " + e.toString());
        }

        return undefined;
    }

    public async getThreadHeaderMessageId(): Promise<SlackMessageId> {
        try {
            if (!this.slackMessageId.ts) {
                logger("You cannot find a status reply without an existing source thread");
                return undefined;
            }

            if (!this.actionMessageId) {
                await this.loadJiraIssueProperties();
            }

            return this.actionMessageId;
        } catch (e) {
            logger("Exception thrown: When trying to get the action bar message ID: " + e.toString());
            return undefined;
        }
    }

    protected getSectionBlockFromText(text: string): SlackBlock {
        return {
            type: "section",
            text: {
                type: "mrkdwn",
                text
            }
        };
    }

    protected getDividerBlock(): SlackBlock {
        return { type: "divider" };
    }

    protected getContextBlock(text: string[]): SlackBlock {
        const elements = text.map((t) => {
            return {
                type: "mrkdwn",
                text: t
            };
        });

        return {
            type: "context",
            elements
        };
    }

    /**
     * Creates the text blocks that should be used to as the thread's top level message.  If you want
     * a purely text-based version of this, then use the buildPlainTextString
     * @param ticket
     * @param state
     * @param ticketLink
     * @param msg
     * @param slackUserId
     */
    public buildTextBlocks(ticket: JiraTicket, state: RequestState, ticketLink?: string, msg?: string, slackUserId?: string): SlackBlock[] {

        const icon = this.iconFromState(state);

        const blocks: SlackBlock[] = [];

        // Ticket Information (if a ticket is given)
        if (ticket) {
            if (ticketLink) {
                blocks.push(this.getSectionBlockFromText(`${icon} *<${ticketLink}|${ticket.key} - ${ticket.fields.summary}>*`));
            } else {
                blocks.push(this.getSectionBlockFromText(`${icon} *${ticket.key} - ${ticket.fields.summary}*`));
            }
        }

        // Last Action Taken (based on message and state parameter
        const status = this.getLastActionText(state, slackUserId, msg);
        if (status) {
            blocks.push(this.getContextBlock([status]));
        }

        // Add the description at the end so that only the description is hidden
        //  by Slack when the message is too long.
        if (ticket && ticket.fields.description) {
            const indentedDescription = replaceAll(ticket.fields.description, { "\n": "\n> " });
            blocks.push(this.getSectionBlockFromText("> " + indentedDescription));
        }

        return blocks;
    }

    public static buildActionBarHeader(): SlackBlock[] {
        return [{
            type: "section",
            text: {
                type: "mrkdwn",
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
                            text: a.name
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
                    type: "mrkdwn",
                    text: `${this.config.REQUEST_WORKING_SLACK_ICON} Waiting...`
                }
            });
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
            return [newViewButton];
        } else if (state === RequestState.todo) {
            return [claimButton, cancelButton, newViewButton];
        } else if (state === RequestState.claimed) {
            return [completeButton, cancelButton, newViewButton];
        } else if (state === RequestState.working) {
            return [];
        } else if (state === RequestState.error) {
            return [];
        } else {
            // if we don't know the state then we should show all the buttons.
            return [claimButton, completeButton, cancelButton, newViewButton];
        }
    };

    public buildPlainTextString(ticket: JiraTicket,
                                state: RequestState,
                                msg?: string,
                                slackUserId?: string): string {

        const lines: string[] = [];

        // Ticket Information (if a ticket is given)
        if (ticket) {
            lines.push(`*${ticket.key} - ${ticket.fields.summary}*`);
        }

        const status = this.getLastActionText(state, slackUserId, msg);
        if (status) {
            lines.push(status);
        }

        // Add the description at the end so that only the description is hidden
        //  by Slack when the message is too long.
        if (ticket && ticket.fields.description) {
            lines.push(ticket.fields.description);
        }

        return lines.join("\n");
    };

    private getLastActionText(state: RequestState, slackUserId: string, msg: string) {
        if (state === RequestState.todo) {
            return `Reported by: <@${slackUserId}>`;
        } else if (state === RequestState.claimed) {
            return `Reported by: <@${this.reporterSlackId}>\nClaimed by: <@${slackUserId}>`;
        } else if (state === RequestState.complete) {
            return `Reported by: <@${this.reporterSlackId}>\nCompleted by <@${slackUserId}>`;
        } else if (state === RequestState.cancelled) {
            return `Reported by: <@${this.reporterSlackId}>\nCancelled by <@${slackUserId}>`;
        } else if (state === RequestState.error) {
            return `${msg ? msg : "Ummm... there was a problem"}}`;
        } else if (state === RequestState.working) {
            return `${msg || "Working..."}`;
        }

        return undefined;
    }
}
