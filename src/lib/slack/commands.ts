import {ISlackAckResponse, SlackSubCommandList} from "@nexus-switchboard/nexus-conn-slack";
import {logger} from "../..";
import {ACTION_MODAL_REQUEST} from "../flows";
import Orchestrator from "../flows/orchestrator";

// Reference: Slack Slash Commands: https://api.slack.com/interactivity/slash-commands

export const requestSubcommands: SlackSubCommandList = {

    default: async (_conn, textWithoutAction, slackParams): Promise<ISlackAckResponse> => {

        Orchestrator.entryPoint(ACTION_MODAL_REQUEST, slackParams, {
            defaultText: textWithoutAction
        })
            .catch((e) => {
                logger("Failed to start detail collection: " + e.toString());
            });

        return {
            code: 200
        };
    }
};
