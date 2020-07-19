import {logger} from "..";
import module from "../index";
import {getNestedVal} from "@nexus-switchboard/nexus-core";
import {SlackPayload, SlackWebApiResponse} from "@nexus-switchboard/nexus-conn-slack"
import {JiraPayload} from "@nexus-switchboard/nexus-conn-jira";

/**
 * The Actor class represents a person who is part of a workflow.  In most cases it's either the reporter of the
 * issue or the assignee.  Actors can be identified in one of two ways: either via Slack or via Jira.  The Actor
 * class tries to hide as much of that as possible from you by figuring out how to get the most information from the
 * least input.  For example, if all it has is a slack user ID, it can try to get the associated Jira user by querying
 * for slack user profile information, getting the email then using that to do a search in Jira.  It then populates
 * the user data associated with Jira in the class.
 */
export class Actor {

    protected _source: "jira" | "slack" | "email";
    protected _email: string;
    protected _slackUserId: string;
    protected _jiraUserId: string;

    // A slack user type: https://api.slack.com/types/user
    private _slackUserRaw: SlackPayload;

    // A jira user type: https://developer.atlassian.com/cloud/jira/platform/rest/v3/?utm_source=%2Fcloud%2Fjira%2Fplatform%2Frest%2F&utm_medium=302#api-rest-api-3-user-get
    private _jiraRawUser: JiraPayload;

    /**
     * Statically caching resolved links between slack and Jira (to avoid expensive calls)
     */
    private static slackToJiraUserMap: { [index: string]: JiraPayload } = {};

    /**
     * Statically caching resolved Slack user object to avoid redundant expensive calls
     */
    private static slackUserIdToProfileMap: { [index: string]: SlackPayload } = {};

    public constructor(info: {email?: string, slackUserId?: string, jiraUserId?: string, jiraRawUser?: JiraPayload}) {

        if (info.email) {
            this._email = info.email;
            this._source = "email";
        } else if (info.slackUserId) {
            this._slackUserId = info.slackUserId;
            this._source = "slack";
        } else if (info.jiraUserId) {
            this._jiraUserId = info.jiraUserId;
            this._source = "jira";
        } else if (info.jiraRawUser) {
            this._jiraRawUser = info.jiraRawUser;
            this._jiraUserId = info.jiraRawUser.accountId;
            this._source = "jira";
        }
    }

    /**
     * Where the originating data came from
     */
    get source(): string {
        return this._source;
    }

    /**
     * Determine if a valid actor has been set either through jira or through slack
     */
    get isValid(): boolean {
        return (!!this._jiraRawUser || !!this._jiraUserId || !!this._slackUserId || !!this._slackUserRaw);
    }

    /**
     * Tries to get the email from either the source email that was set or one of the raw objects that has
     * already been retrieved.  This will not try to load the raw data from slack or Jira, though.  If you want
     * to get the raw data first, you can try to call loadBestRawObject which will look at the information it already
     * has and pick either slack or jira to load data from.
     */
    get email(): string {
        if (!this._email) {

            if (this._slackUserRaw) {
                this._email = getNestedVal(this._slackUserRaw, "profile.email");
            }

            if (!this._email && this._jiraRawUser) {
                this._email = getNestedVal(this._jiraRawUser, "emailAddress");
            }
        }

        return this._email;
    }

    get slackUserId(): string {
        return this._slackUserId;
    }

    get jiraUserId(): string {
        return this._jiraUserId;
    }

    get jiraRawUser(): JiraPayload {
        return this._jiraRawUser;
    }

    get slackRawUser(): JiraPayload {
        return this._slackUserRaw;
    }

    /**
     * Tries to find the actor's real name only if raw data from either slack or Jira
     * has been downloaded already.  If not, it returns an empty string.  If both jira and
     * slack data are available, it will use Slack.
     */
    get realName(): string {
        if (!this._slackUserRaw && !this._jiraRawUser) {
            return "";
        } else {
            let name = "";
            if (this._slackUserRaw) {
                name = getNestedVal(this._slackUserRaw, "profile.real_name") || "";
            }

            if (!name && this._jiraRawUser) {
                name = getNestedVal(this._jiraRawUser, "name") || "";
            }
            return name;
        }
    }

    public getBestUserStringForSlack() {
        // Prefer to use the Slack user for rendering in slack.
        let userStr: string;
        if (this.slackUserId) {
            userStr = `<@${this.slackUserId}>`;
        } else if (this.jiraRawUser) {
            userStr = getNestedVal(this.jiraRawUser, 'displayName');
        } else {
            userStr = "No User";
        }
        return userStr;
    }

    /**
     * This does a smart load of user data from either Slack or Jira.  It makes the determination based on what
     * ID information is available and what the source of that information was.  For example, if it has both
     * a slack ID and a jira ID but the source of the Actor's originating data was slack, it will use the slack ID
     * to pull information from Slack.
     *
     * If it already has either jira or slack raw data, it will just return true.
     */
    public async loadBestRawObject(): Promise<boolean> {
        if (this._jiraRawUser || this._slackUserRaw) {
            // We've already download some raw data so just use whichever one is best.
            return true;
        }

        // Use the jira source if the originator of this object was jira and we have a
        //  a jira user id OR if we don't have a slack user ID but we do have a jira user ID
        if ((this.source == "jira" && this._jiraUserId) || (!this._slackUserId && this._jiraUserId)) {
            await this.getRawJiraUser();
            return true;
        } else if ((this.source === "slack" && this._slackUserId) || (!this._jiraUserId && this._slackUserId)) {
            await this.getRawSlackUser();
            return true;
        } else {
            return false;
        }

    }

    /**
     * Loads the raw slack data (if it doesn't have it already) and returns that.  This is the user object
     * as it is defined here:
     *  https://api.slack.com/types/user
     */
    public async getRawSlackUser(): Promise<SlackPayload> {
        if (!this._slackUserRaw) {
            this._slackUserRaw = await Actor.getSlackUserDataFromSlackId(this.slackUserId);
            this._slackUserId = getNestedVal(this._slackUserRaw, 'id');
        }

        return this._slackUserRaw;
    }

    /**
     * Loads the raw jira data (if it doesn't have it already) and returns that.  This is the user object
     * as it is defined here:
     * https://developer.atlassian.com/cloud/jira/platform/rest/v3/?utm_source=%2Fcloud%2Fjira%2Fplatform%2Frest%2F&utm_medium=302#api-rest-api-3-user-get
     */
    public async getRawJiraUser(): Promise<JiraPayload> {
        let email = this.email;
        if (!this._jiraRawUser) {
            if (!email) {
                if (this._slackUserRaw) {
                    email = getNestedVal(this._slackUserRaw, 'profile.email')
                }
            }

            if (email) {
                this._jiraRawUser = Actor.getJiraUserDataFromEmail(email);
                this._jiraUserId = getNestedVal(this._jiraRawUser, 'accountId');
            } else {
                throw new Error(`Unable to get the jira raw user data because no email could be determined.`);
            }
        }

        return this._jiraRawUser
    }

    /**
     * Uses the given email address to find the raw user object.
     * @param email
     */
    public static async getJiraUserDataFromEmail(email: string): Promise<JiraPayload> {

        try {
            if (email in Actor.slackToJiraUserMap) {
                return Actor.slackToJiraUserMap[email];
            }

            // JIRA API call to get user data based on email
            const users = await module.getJira().api.userSearch.findUsers({
                query: email
            });

            if (users && users.length > 0) {
                Actor.slackToJiraUserMap[email] = users[0];
                return users[0];
            } else {
                return undefined;
            }

        } catch (e) {
            logger(`Unable to find a user with the email address ${email} due to the following error: ${e.message}`);
            return undefined;
        }
    }

    /**
     * Uses the given slack ID to try to load the slack user object/profile from the Slack API.
     * @param slackUserId
     */
    public static async getSlackUserDataFromSlackId(slackUserId: string): Promise<SlackPayload> {
        try {
            if (slackUserId in Actor.slackUserIdToProfileMap) {
                return Actor.slackUserIdToProfileMap[slackUserId];
            }

            const userInfo = await module.getSlack().apiAsBot.users.info({user: slackUserId}) as SlackWebApiResponse;
            if (userInfo && userInfo.ok) {

                // Keep in a static cache of user IDs to slack raw data for future reference.
                Actor.slackUserIdToProfileMap[slackUserId] = userInfo.user;

                // Return the raw value.
                return userInfo.user;

            } else {
                return undefined;
            }
        } catch (e) {
            logger("Exception thrown: Trying to get user details from a user ID: " + e.toString());
            return undefined;
        }
    }

}
