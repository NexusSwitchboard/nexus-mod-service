import {ISlackAckResponse, SlackSubCommandList} from "@nexus-switchboard/nexus-conn-slack";
import {ACTION_MODAL_REQUEST} from "../flows";
import Orchestrator from "../flows/orchestrator";

// Reference: Slack Slash Commands: https://api.slack.com/interactivity/slash-commands

export const requestSubcommands: SlackSubCommandList = {

    default: async (_conn, textWithoutAction, slackParams): Promise<ISlackAckResponse> => {

        Orchestrator.entryPoint("slack", ACTION_MODAL_REQUEST, slackParams, {
            defaultText: textWithoutAction
        });

        return {
            code: 200
        };
    }
};
