import { WebAPICallResult } from "@slack/web-api";

import { JiraConnection, JiraPayload } from "@nexus-switchboard/nexus-conn-jira";
import { SlackConnection, SlackPayload } from "@nexus-switchboard/nexus-conn-slack";
import { getNestedVal, ModuleConfig } from "@nexus-switchboard/nexus-extend";

import moduleInstance from "../../index";
import template from "../../views/homeTab.view";
import { logger } from "../../index";
import {getIssueState, iconFromState} from "../util";

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

export class SlackHomeTab {
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
    private readonly maxIssueCount: number=75;

    constructor(userId?: string) {
        this.slack = moduleInstance.getSlack();
        this.jira = moduleInstance.getJira();
        this.config = moduleInstance.getActiveModuleConfig();
        this.userId = userId;
    }

    public async publish(): Promise<SlackPayload> {
        const label = this.config.REQUEST_JIRA_SERVICE_LABEL;

        // get a list of open requests
        return this.getAllOpenRequests()
            .then((results): Promise<IssueTemplateData[]> => {
                const issues = results.issues.slice(0,this.maxIssueCount);
                return Promise.all(issues.map(async (issue: JiraPayload) => {

                    let initiatingSlackUserId: string;
                    let permalink: string;

                    const requestInfo = getNestedVal(issue, `properties.${label}`);
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

                    const state = getIssueState(issue, this.config);
                    return {
                        key: issue.key,
                        state,
                        stateIcon: iconFromState(state, this.config),
                        summary: issue.fields.summary,
                        reporter: initiatingSlackUserId ? `<@${initiatingSlackUserId}>` : "Unknown",
                        status: issue.fields.status.name,
                        thread_url: permalink,
                        ticket_url: this.jira.keyToWebLink(this.config.JIRA_HOST, issue.key)
                    } as IssueTemplateData;
                }));
            })
            .then((issues: IssueTemplateData[]) => {
                const view = template({issues})
                return this.slack.apiAsBot.views.publish({
                    user_id: this.userId,
                    view
                });
            });
    }

    public async getAllOpenRequests() {
        const label = this.config.REQUEST_JIRA_SERVICE_LABEL;
        const project = this.config.REQUEST_JIRA_PROJECT;
        const issueTypeId = this.config.REQUEST_JIRA_ISSUE_TYPE_ID;

        const jql = `issuetype=${issueTypeId} and project="${project}" and labels in ("${label}-request") and statusCategory in ("To Do","In Progress") order by created desc`;
        return this.jira.api.issueSearch.searchForIssuesUsingJqlPost({
            jql,
            fields: ["*all"],
            properties: [label]
        });
    }

}
