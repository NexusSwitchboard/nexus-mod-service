import { SlackMessageId } from './slackMessageId';
import { logger } from '..';
import { NexusModuleConfig } from '@nexus-switchboard/nexus-extend';
import { RequestState } from './request';
import { JiraTicket } from '@nexus-switchboard/nexus-conn-jira';
import { SlackBlock, SlackConnection } from '@nexus-switchboard/nexus-conn-slack';
import { replaceAll } from './util';

export const claimButton: IssueAction = {
    code: 'claim_request',
    name: 'Claim',
    style: 'primary'
};

export const cancelButton: IssueAction = {
    code: 'cancel_request',
    name: 'Cancel',
    style: 'danger'
};

export const completeButton: IssueAction = {
    code: 'complete_request',
    name: 'Complete',
    style: 'primary'
};

export const viewButton: IssueAction = {
    code: 'view_request',
    name: 'View Ticket',
    style: 'primary',
    url: undefined
};


export type IssueAction = {
    code: string,
    name: string,
    style?: 'primary' | 'danger',
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
            throw new Error('You cannot find a status reply without an existing source thread');
        }

        try {
            const messages = await this.slack.getChannelThread(this.slackMessageId.channel,
                this.slackMessageId.ts);

            // pull only the messages that belong to the bot.
            const botMessages = messages.filter((m) => m.hasOwnProperty('username') &&
                m.username.toLowerCase() === this.config.SLACK_BOT_USERNAME.toLowerCase());

            // the first one will be the originating message which should always be the bots.
            if (botMessages.length > 1) {
                return new SlackMessageId(this.slackMessageId.channel, botMessages[1].ts);
            } else {
                return undefined;
            }

        } catch (e) {
            logger('Exception thrown: Unable to find status reply message due to this error: ' + e.toString());
            return undefined;
        }
    }

    protected getSectionBlockFromText(text: string): SlackBlock {
        return {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text
            }
        };
    }

    protected getDividerBlock(): SlackBlock {
        return { type: 'divider' };
    }

    protected getContextBlock(text: string[]): SlackBlock {
        const elements = text.map((t) => {
            return {
                type: 'mrkdwn',
                text: t
            };
        });

        return {
            type: 'context',
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
        let status = '';
        if (state === RequestState.todo) {
            status = `Issue submitted by <@${slackUserId}>`;
        } else if (state === RequestState.claimed) {
            status = `Issue claimed by <@${slackUserId}>`;
        } else if (state === RequestState.complete) {
            status = `Issue completed by <@${slackUserId}>`;
        } else if (state === RequestState.cancelled) {
            status = `Issue cancelled by <@${slackUserId}>`;
        } else if (state === RequestState.error) {
            status = `${msg ? msg : 'Ummm... there was a problem'}}`;
        } else if (state === RequestState.working) {
            status = `${msg || 'Working...'}`;
        }

        if (status) {
            blocks.push(this.getContextBlock([status]));
        }

        // Add the description at the end so that only the description is hidden
        //  by Slack when the message is too long.
        if (ticket && ticket.fields.description) {
            const indentedDescription = replaceAll(ticket.fields.description, { '\n': '\n> ' });
            blocks.push(this.getSectionBlockFromText('> ' + indentedDescription));
        }

        return blocks;
    }

    public static buildActionBarHeader(): SlackBlock[] {
        return [{
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '*Ticket Actions*'
            }
        }];
    }

    public buildActionBlocks(state: RequestState, ticket?: JiraTicket, jiraLink?: string) {
        const actions = RequestThread.getMessageActions(state, ticket, jiraLink);

        const blocks: SlackBlock[] = RequestThread.buildActionBarHeader();

        if (actions.length > 0) {
            blocks.push({
                type: 'actions',
                block_id: 'infra_request_actions',
                elements: actions.map((a) => {
                    return {
                        type: 'button',
                        text: {
                            type: 'plain_text',
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
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `${this.config.REQUEST_WORKING_SLACK_ICON} Waiting...`
                }
            });
        }
        return blocks;
    }

    private iconFromState(state: RequestState): string {

        const statusToIconMap: Record<RequestState, string> = {
            [RequestState.working]: this.config.REQUEST_WORKING_SLACK_ICON || ':clock1:',
            [RequestState.error]: this.config.REQUEST_ERROR_SLACK_ICON || ':x:',
            [RequestState.complete]: this.config.REQUEST_COMPLETED_SLACK_ICON || ':white_circle:',
            [RequestState.todo]: this.config.REQUEST_SUBMITTED_SLACK_ICON || ':black_circle:',
            [RequestState.cancelled]: this.config.REQUEST_CANCELLED_SLACK_ICON || ':red_circle:',
            [RequestState.claimed]: this.config.REQUEST_CLAIMED_SLACK_ICON || ':large_blue_circle:',
            [RequestState.unknown]: ':red_circle'
        };

        return state in statusToIconMap ? statusToIconMap[state] : ':question:';
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

        // Last Action Taken (based on message and state parameter
        if (state === RequestState.todo) {
            lines.push(`Issue submitted by <@${slackUserId}>`);
        } else if (state === RequestState.claimed) {
            lines.push(`Issue claimed by <@${slackUserId}>`);
        } else if (state === RequestState.complete) {
            lines.push(`Issue completed by <@${slackUserId}>`);
        } else if (state === RequestState.cancelled) {
            lines.push(`Issue cancelled by <@${slackUserId}>`);
        } else if (state === RequestState.error) {
            lines.push(`${msg ? msg : 'Ummm... there was a problem'}}`);
        } else if (state === RequestState.working) {
            lines.push(`${msg || 'Working...'}`);
        }

        // Add the description at the end so that only the description is hidden
        //  by Slack when the message is too long.
        if (ticket && ticket.fields.description) {
            lines.push(ticket.fields.description);
        }

        return lines.join('\n');
    };
}
