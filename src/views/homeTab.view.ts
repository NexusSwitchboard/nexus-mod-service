import {IssueTemplateData} from "../lib/slack/homeTab";

export default (data: any): any => {
    const ob = {
        type: "home",
        blocks: [] as any
    };
    ob.blocks.push({
        "type": "section",
        "text": {
            "type": "mrkdwn",
            "text": "*Open Issues*\nThis is where you can find requests that are either Unclaimed or In-Progress across all channels"
        }
    })

    if (data.issues && data.issues.length > 0) {
        data.issues.forEach((issue: IssueTemplateData) => {
            ob.blocks.push(
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": `${issue.stateIcon} *<${issue.ticket_url}|${issue.key}> - ${issue.summary}*\n`+
                                `*Status:* ${issue.state}   *Reporter:* ${issue.reporter ? issue.reporter : '_Unknown_'}\n` +
                                `${issue.thread_url ? `<${issue.thread_url}|View thread>` : '_Conversation could not be found_'}`
                    }
                })
        });
    } else {
        ob.blocks.push({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": ":nerd_face: *There are no open issues!*"
            }
        });
    }

    return ob;
};
