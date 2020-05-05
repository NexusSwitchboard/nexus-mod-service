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
        data.issues.forEach((issue: {
            thread_url: string;
            key: any; summary: any; reporter: any;
        }) => {
            ob.blocks.push(
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": `*<{{ticket_url}}|${issue.key}> - {${issue.summary}}*`
                    }
                })

            ob.blocks.push(
                {
                    "type": "section",
                    "fields": [
                        {
                            "type": "mrkdwn",
                            "text": "*Status*\n${status}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": `*Reported by*\n${issue.reporter ? issue.reporter : '_Unknown_'}`
                        }
                    ]
                })

            ob.blocks.push(
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": `${issue.thread_url ? `<${issue.thread_url}|View thread>` : '_Conversation could not be found_'}`
                        }
                    ]
                }
            )

            ob.blocks.push(
                {
                    "type": "divider"
                });
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