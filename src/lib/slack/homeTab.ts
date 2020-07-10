import {WebAPICallResult} from "@slack/web-api";

import {JiraConnection, JiraPayload} from "@nexus-switchboard/nexus-conn-jira";
import {SlackConnection, SlackPayload} from "@nexus-switchboard/nexus-conn-slack";
import {getNestedVal, ModuleConfig} from "@nexus-switchboard/nexus-extend";

import moduleInstance from "../../index";
import template from "../../views/homeTab.view";
import {logger} from "../../index";
import {getIssueState, iconFromState} from "../util";
import {ServiceIntent} from "../intents";
import {IntentManager} from "../intents/manager";

export type IssueTemplateData = {
    key: string,
    state: string,
    stateIcon: string,
    summary: string,
    reporter: string
    status: string,
    thread_url: string,
    ticket_url: string
};

export type IntentTicketResults = {
    intent: ServiceIntent,
    issues: JiraPayload[]
}

export class SlackHomeTab {
    /**
     * Shortcut to the connection instance.
     */
    private readonly intentManager: IntentManager;

    /**
     * Shortcut to the connection instance.
     */
    private readonly slack: SlackConnection;

    /**
     * Shortcut to the connection instance.
     */
    private readonly jira: JiraConnection;

    /**
     * Shortcut to the module config object
     */
    private readonly config: ModuleConfig;

    /**
     * This is the ID of the user whose home page is being updated.
     */
    private readonly userId: string;

    /**
     * This is the ID of the user whose home page is being updated.
     */
    private readonly maxIssueCount: number = 25;

    constructor(intents: IntentManager, userId?: string) {
        this.slack = moduleInstance.getSlack();
        this.jira = moduleInstance.getJira();
        this.config = moduleInstance.getActiveModuleConfig();
        this.userId = userId;
        this.intentManager = intents;
    }

    public async publish(): Promise<SlackPayload> {

        // get a list of open requests
        await this.slack.apiAsBot.views.publish({
            user_id: this.userId,
            view: {
                type: "home",
                blocks: [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            text: ":gear: Pulling together open and/or claimed tickets...",
                        }
                    }
                ]
            }
        });

        const openRequestsRaw: IntentTicketResults[] = await this.getAllOpenRequests();

        // This was an addition to incorporate multiple intents into the home tab.
        //  The safest way to do it at this time is to combine the issues from all
        //  intents and use a null divider to indicate to the renderer that there should
        //  be some kind of divider in the UI.
        let allIssues: JiraPayload[] = [];
        openRequestsRaw.forEach((result) => {
            if (result.issues.length) {
                // this will be interpreted as a divider by the template engine.
                allIssues.push({divider: true, intent: result.intent});
                allIssues = allIssues.concat(result.issues.slice(0, this.maxIssueCount));
            }
        });

        // The current intent variable is updated every time a special "divider" type is
        //  found in the list.  This represents the beginning of a new intent's list of issues.  We
        //  reflect that in the UI with a header containing the name of the intent.
        let currentIntent: ServiceIntent = undefined;
        let templateIssues: IssueTemplateData[] = [];
        for (let i = 0; i < allIssues.length; i++) {
            const issue = allIssues[i];
            if (getNestedVal(issue, 'divider')) {
                // So this is a special entry that is not actually an issue but is
                //  meant to represent the end of one intent and the start of another one.
                //  it contains a name string which represents the name of the

                currentIntent = issue.intent;

                templateIssues.push({
                    key: "_DIVIDER_",
                    state: undefined,
                    stateIcon: undefined,
                    summary: issue.intent.name,
                    reporter: undefined,
                    status: undefined,
                    thread_url: undefined,
                    ticket_url: undefined
                })
            } else {

                // If we got to an actual issue in the list then we MUST have gotten a divider first which means
                //  the first issue in the array is always a divider.
                if (!currentIntent) {
                    logger("During home tab rendering, the list contained an issue with an " +
                        "associated intent.  This shouldn't happen.");
                    continue;
                }

                let initiatingSlackUserId: string;
                let permalink: string;

                const requestInfo = getNestedVal(issue, `properties.${currentIntent.config.jira.serviceLabel}`);
                if (requestInfo) {
                    const channelId = requestInfo.channelId;
                    const threadId = requestInfo.threadId;
                    const originalChannelId = requestInfo.notificationChannelId;
                    initiatingSlackUserId = requestInfo.reporterSlackId;

                    try {
                        const result: WebAPICallResult = await this.slack.apiAsBot.chat.getPermalink({
                            channel: channelId,
                            message_ts: threadId,
                            originatingChannel: originalChannelId
                        });
                        permalink = result.permalink as string;
                    } catch (e) {
                        logger(`Unable to get permalink for ${issue.key}: ${e.toString()}`);
                    }
                }

                const state = getIssueState(issue, currentIntent);
                templateIssues.push({
                    key: issue.key,
                    state,
                    stateIcon: iconFromState(state, currentIntent),
                    summary: issue.fields.summary,
                    reporter: initiatingSlackUserId ? `<@${initiatingSlackUserId}>` : "Unknown",
                    status: issue.fields.status.name,
                    thread_url: permalink,
                    ticket_url: this.jira.keyToWebLink(this.config.jira.hostname, issue.key)
                } as IssueTemplateData);

            }
        }

        // Now we take the prepared template data and render it using the template
        const view = template({issues:templateIssues})

        // And finally we can take the view that was generated and publish it to the home page surface.
        return await this.slack.apiAsBot.views.publish({
            user_id: this.userId,
            view
        });
    }

    public async getAllOpenRequests(): Promise<IntentTicketResults[]> {

        return Promise.all(this.intentManager.intents.map((intent: ServiceIntent) => {
            return this.jira.api.issueSearch.searchForIssuesUsingJqlPost({
                jql: intent.getJql({statusCategories: ["To Do", "In Progress"]}),
                fields: ["*all"],
                properties: [intent.getJiraConfig().serviceLabel]
            }).then((results: any) => {
                return {
                    intent,
                    issues: results.issues
                }
            });
        }))
    }

}
