import {logger, ServiceModule} from "../../index";
import {SlackHomeTab} from "../slack/homeTab";
import {IIntentConfig, ServiceIntent} from "./index";

import {
    ISlackAckResponse,
    ISlackCommand, ISlackInteractionHandler,
    SlackConnection,
    SlackEventList,
    SlackPayload
} from "@nexus-switchboard/nexus-conn-slack";

import {WebhookConfiguration} from "atlassian-addon-helper";
import {ClaimServiceIntent} from "./claim";

/**
 * Does the work of determing which intent should be used when receiving
 * a trigger either through a slack event, slack interaction or jira event.
 */
export class IntentManager {
    readonly _intents: ServiceIntent[];

    public constructor() {
        this._intents = [];
    }

    public async initialize() {
        for (let i = 0; i < this._intents.length; i++) {
            await this._intents[i].initialize();
        }
    }

    public get intents() {
        return this._intents;
    }

    public addIntentFromConfig(intent: IIntentConfig, module: ServiceModule) {
        if (intent.type === "claim") {
            this._intents.push(new ClaimServiceIntent(intent, module));
        } else {
            throw new Error("An attempt to add an intent of an unknown type: " + intent.type);
        }
    }

    public handleSlackEvent(payload: SlackPayload): void {
        for (let i = 0; i < this._intents.length; i++) {
            this._intents[i].handleSlackEvent(payload);
        }
    }

    public getSlashCommandsConfig(): ISlackCommand[] {
        return this._intents.filter((intent) => {
            return !!intent.getSlashCommandName();
        }).map((intent) => {
            return {
                command: intent.getSlashCommandName(),
                defaultSubCommand: "default",
                subCommandListeners: intent.getSubCommandMap()
            }
        })
    }

    public getJiraEventHandlers(): WebhookConfiguration[] {

        // Collect a list of event handlers from each of the intents.  If there is more than one event handler
        //  of the same type then only the first will be used.  THIS IS A BUG that must be resolved in the
        //  atlassian-addon-helper by
        const arrayOfArrays = this._intents.map((intent: ServiceIntent) => {
            return intent.getJiraEventHandlers()
        });

        return [].concat(...arrayOfArrays)
    }

    public getSlackEventsConfig(): SlackEventList {
        return {
            message: async (_conn: SlackConnection, payload: SlackPayload): Promise<ISlackAckResponse> => {
                this.handleSlackEvent(payload);

                return {
                    code: 200
                }
            },
            app_home_opened: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
                const home = new SlackHomeTab(this, slackParams.user);
                home.publish().catch((e) => {
                    logger("Failed to publish new home page after `app_home_opened` event received: " + e.toString());
                });

                return {
                    code: 200
                }
            }
        }
    }

    public getSlackInteractionsConfig(): ISlackInteractionHandler[] {

            // Collect a list of event handlers from each of the intents.  If there is more than one event handler
            //  of the same type then only the first will be used.  THIS IS A BUG that must be resolved in the
            //  atlassian-addon-helper by
            const arrayOfArrays = this._intents.map((intent: ServiceIntent) => {
                return intent.getSlackInteractions()
            });

            return [].concat(...arrayOfArrays)
    }

}
