import { WebAPICallResult } from "@slack/web-api";

import { JiraConnection, JiraPayload } from "@nexus-switchboard/nexus-conn-jira";
import { SlackConnection, SlackPayload } from "@nexus-switchboard/nexus-conn-slack";
import { ModuleConfig } from "@nexus-switchboard/nexus-extend";

import moduleInstance from "..";
import Handlebars from "handlebars";
import { join } from "path";
import { TEMPLATE_DIR } from "../index";
import { readFileSync } from "fs";

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
     * This template is used to build the blocks for the home tab view.
     */
    private readonly homeTabTemplate: HandlebarsTemplateDelegate;


    /**
     * This is the ID of the user whose home page is being updated.
     */
    private readonly userId: string;

    constructor (userId?: string) {
        this.slack = moduleInstance.getSlack();
        this.jira = moduleInstance.getJira();
        this.config = moduleInstance.getActiveModuleConfig();
        this.userId = userId;

        const txt = readFileSync(join(TEMPLATE_DIR, "home_tab.json"), 'utf8');
        this.homeTabTemplate = Handlebars.compile(txt);

    }

    public async publish(): Promise<SlackPayload> {
        const label = this.config.REQUEST_JIRA_SERVICE_LABEL;

        // get a list of open requests
        return this.getAllOpenRequests()
            .then((results) => {

                return Promise.all(results.issues.map(async (issue: JiraPayload) => {

                    let initiatingSlackUserId: string;
                    let permalink: string;

                    if (issue.properties) {
                        const channelId = issue.properties[label].channelId;
                        const threadId = issue.properties[label].threadId;
                        const originalChannelId = issue.properties[label].notificationChannelId;
                        initiatingSlackUserId = issue.properties[label].reporterSlackId;

                        const result: WebAPICallResult = await this.slack.apiAsBot.chat.getPermalink({
                            channel: channelId,
                            message_ts: threadId,
                            originatingChannel: originalChannelId,
                        });
                        permalink = result.permalink as string;
                    }

                    return {
                        key: issue.key,
                        summary: issue.fields.summary,
                        reporter: initiatingSlackUserId ? `<@${initiatingSlackUserId}>` : 'Unknown',
                        status: issue.fields.status.name,
                        thread_url: permalink

                    }
                }));
            })
            .then((tmplData) => {
                const json = this.homeTabTemplate({
                    issues: tmplData
                });
                const view = JSON.parse(json);

                return this.slack.apiAsBot.views.publish({
                    user_id: this.userId,
                    view
                })
            });
    }

    public async getAllOpenRequests() {
        const label = this.config.REQUEST_JIRA_SERVICE_LABEL;

        const jql = `labels in ("${label}-request") and statusCategory in ("To Do","In Progress")`;
        return this.jira.api.issueSearch.searchForIssuesUsingJqlPost({
            jql,
            fields: ["*all"],
            properties: [label]
        })
    }

}