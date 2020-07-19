import {ServiceIntent} from "./index";
import {IWebhookPayload, WebhookConfiguration} from "atlassian-addon-helper";
import {
    ISlackAckResponse,
    SlackConnection,
    SlackPayload,
    SlackSubCommandList,
    SlackInteractionType,
    ISlackInteractionHandler
} from "@nexus-switchboard/nexus-conn-slack";
import {noop} from "../util";
import {IConfigGroups, getNestedVal} from "@nexus-switchboard/nexus-core";

import {
    ACTION_CANCEL_REQUEST,
    ACTION_CLAIM_REQUEST,
    ACTION_COMMENT_ON_REQUEST,
    ACTION_COMPLETE_REQUEST, ACTION_CREATE_REQUEST, ACTION_MODAL_REQUEST, ACTION_PAGE_REQUEST, ACTION_TICKET_CHANGED
} from "../flows";
import ServiceRequest from "../request";
import moduleInstance, {logger} from "../../index";
import {ClaimFlow} from "../flows/claim";
import {IntakeFlow} from "../flows/intake";
import {contentConfigurationRules, jiraConfigurationRules, slackConfigurationRules} from "../config";
import assert from "assert";

export class ClaimServiceIntent extends ServiceIntent {

    public async initialize() {
        await super.initialize();

        this.getFlowOrchestrator().addFlow(new IntakeFlow(this));
        this.getFlowOrchestrator().addFlow(new ClaimFlow(this));
    }

    public handleSlackEvent(payload: SlackPayload) {
        // Override to handle event
        const eventType = getNestedVal(payload, 'type');
        if (eventType === 'message') {
            if (!ServiceRequest.isBotMessage(payload.message || payload)) {
                this.getFlowOrchestrator().entryPoint("slack", ACTION_COMMENT_ON_REQUEST, payload, this);
            }
        }
    }

    public getSlackInteractions(): ISlackInteractionHandler[]  {
        return [{
            /************
             * BLOCK BUTTON ACTION HANDLER: Claim, Cancel or Complete existing request
             * This is the handler for when the user clicks one of the buttons at the bottom of the created request
             * message that appears in the originating message's thread.
             */

            matchingConstraints: { blockId: "infra_request_actions" },
            type: SlackInteractionType.action,
            handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
                assert(slackParams.actions && slackParams.actions.length > 0,
                    "Received slack action event but actions array appears to be empty");

                if (slackParams.actions[0].value === "view_request") {
                    return {
                        code: 200
                    };
                }

                ////////// CLAIM
                if (slackParams.actions[0].value === "claim_request") {
                    this.orchestrator.entryPoint("slack", ACTION_CLAIM_REQUEST, slackParams, this).then(noop);
                }

                ////////// CANCEL
                if (slackParams.actions[0].value === "cancel_request") {
                    this.orchestrator.entryPoint("slack", ACTION_CANCEL_REQUEST, slackParams, this).then(noop);
                }

                ////////// COMPLETE
                if (slackParams.actions[0].value === "complete_request") {
                    this.orchestrator.entryPoint("slack", ACTION_COMPLETE_REQUEST, slackParams, this).then(noop);
                }

                ////////// PAGE ON-CALL BUTTON
                if (slackParams.actions[0].value === "page_request") {
                    this.orchestrator.entryPoint("slack", ACTION_PAGE_REQUEST, slackParams, this).then(noop);
                }

                return {
                    code: 200
                };
            }
        }, {
            /************
             * MESSAGE ACTION HANDLER: Create Request
             * This is the handler for when the user right clicks on a message and chooses the submit request action
             */
            matchingConstraints: { callbackId: "submit_request" },
            type: SlackInteractionType.action,
            handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {

                this.orchestrator.entryPoint("slack", ACTION_MODAL_REQUEST, slackParams, this).then(noop);

                return {
                    code: 200
                };
            }
        }, {
            /************
             * GLOBAL SHORTCUT HANDLER: Create Request
             * This is the handler for when uses a global shortcut (meaning it's not tied to a message or a channel)
             */
            matchingConstraints: { callbackId: "submit_request" },
            type: SlackInteractionType.shortcut,
            handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
                this.orchestrator.entryPoint("slack", ACTION_MODAL_REQUEST, slackParams, this).then(noop);
                return {
                    code: 200
                };
            }
        }, {
            /************
             * MESSAGE ACTION HANDLER: Submit Request
             * This is the handler for when the user presses the submit button the Create Request modal.
             */

            matchingConstraints: "infra_request_modal",
            type: SlackInteractionType.viewSubmission,
            handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
                this.orchestrator.entryPoint("slack", ACTION_CREATE_REQUEST, slackParams, this).then(noop);

                return {
                    code: 200,
                    response_action: "clear"
                };
            }
        }, {
            /************
             * MESSAGE ACTION HANDLER: Request modal dismissed
             * This is the handler for when the user dismissed the request dialog.
             */

            matchingConstraints: "infra_request_modal",
            type: SlackInteractionType.viewClosed,
            handler: async (_conn: SlackConnection, _slackParams: SlackPayload): Promise<ISlackAckResponse> => {

                // NOTE: This is no longer necessary because we don't show a message before the dialog
                //  is displayed.  Leaving here for posterity in case we change the way that is handled in the future.
                // const modConfig = moduleInstance.getActiveModuleConfig();
                //
                // const metaData = findProperty(slackParams, "private_metadata");
                // if (metaData) {
                //     const slackData = parseEncodedSlackData(metaData);
                //     const message = await _conn.getMessageFromChannelAndTs(
                //         slackData.conversationMsg.channel, slackData.conversationMsg.ts);
                //
                //     if (ServiceRequest.isBotMessage(message, modConfig.SLACK_BOT_USERNAME)) {
                //         _conn.apiAsBot.chat.delete({
                //             channel: slackData.conversationMsg.channel,
                //             ts: slackData.conversationMsg.ts,
                //             as_user: true
                //         })
                //             .catch((e: any) => {
                //                 logger(`Error when trying to delete the generated message for a slash command invoked request: ${e.toString()}`);
                //             });
                //     }
                // }
                return {
                    code: 200
                };
            }
        }]
    }

    public getJiraEventHandlers(): WebhookConfiguration[] {
        let filter: string;
        const label = this.getJiraConfig().serviceLabel;
        if (this.getJiraConfig().project) {
            filter = `project="${this.getJiraConfig().project}" and labels in ("${label}-request")`
        } else {
            logger("Webhooks could not be setup because there was no Jira project specified in the config");
            return []
        }

        return [
            {
                definition: {
                    event: "comment_created",
                    filter,
                    propertyKeys: [this.getJiraConfig().serviceLabel]
                },

                handler: async (payload: IWebhookPayload): Promise<boolean> => {

                    // Only handle the change if it was not made by the API user.
                    const accountId = moduleInstance.getJira().getApiUserAccountId();
                    const userId = getNestedVal(payload, "comment.author.accountId");
                    if (!userId) {
                        logger("Unable to extract user ID from comment webhook payload");
                        return false;
                    }

                    if (userId === accountId) {
                        logger("Received a new comment but it was posted by the bot so ignoring...");
                        return false;
                    }

                    // the payload does not contain full issue details so populate that now.

                    await this.orchestrator.entryPoint("jira", ACTION_COMMENT_ON_REQUEST, payload, this);
                    return true;
                }
            },
            {
                definition: {
                    event: "jira:issue_updated",
                    filter,
                    propertyKeys: [this.getJiraConfig().serviceLabel]

                },
                handler: async (payload: IWebhookPayload): Promise<boolean> => {

                    // Only handle the change if it was not made by the API user.
                    let myOwnChange = false;
                    const accountId = this.module.getJira().getApiUserAccountId();
                    if (payload.user && payload.user.accountId) {
                        if (payload.user.accountId == accountId) {
                            myOwnChange = true;
                        }
                    }

                    if (!myOwnChange) {

                        let isRelevantChange = false;

                        // Only handle this change if one of the relevant fields changed.  Iterate through
                        //  the changes and as soon a relevant one is encountered, notify the orchestrator
                        //  and exit the loop.
                        for (let change of payload.changelog.items) {
                            if (["status", "summary", "description", "assignee"].indexOf(change.field) >= 0) {
                                isRelevantChange = true;
                                break;
                            }
                        }

                        if (isRelevantChange) {
                            await this.orchestrator.entryPoint("jira", ACTION_TICKET_CHANGED, payload, this);
                        }
                    }

                    return Promise.resolve(true);
                }
            }
        ]
    }

    public getSubCommandMap(): SlackSubCommandList {
        return {

            default: async (_conn: SlackConnection, textWithoutAction: string, slackParams: SlackPayload): Promise<ISlackAckResponse> => {

                this.getFlowOrchestrator().entryPoint("slack", ACTION_MODAL_REQUEST, slackParams, this, {
                    defaultText: textWithoutAction
                }).then(noop);

                return {
                    code: 200
                };
            }
        }
    }

    /**
     * Return the JQL required to return all tickets associated with this intent.
     */
    public getJql(options: { limit?: number, statusCategories?: string[] }): string {
        const label = this.getJiraConfig().serviceLabel;
        const project = this.getJiraConfig().project;
        const issueTypeId = this.getJiraConfig().issueTypeId;

        let base = `issuetype=${issueTypeId} and project="${project}" and labels in ("${label}-request")`;

        if (options.statusCategories) {
            // for the jql, the status categories need to be surrounded by double-quotes
            options.statusCategories = options.statusCategories.map((stat) => {
                return `"${stat}"`
            });
            base += ` and statusCategory in (${options.statusCategories.join(',')})`;
        }

        if (options.limit) {
            base += ` limit ${options.limit}`
        }

        return base;
    }

    /**
     * The configuration rules are validators that are used by the core during startup
     * to ensure that your expected configuration matches the configuration being given
     * by the client.
     */
    public getConfigRules(): IConfigGroups {
        return {
            'Jira Integration': jiraConfigurationRules,
            'Slack Integration': slackConfigurationRules,
            'Content Strings': contentConfigurationRules
        }
    }
}
