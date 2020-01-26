import {logger} from "..";

export class SlackMessageId {

    public static fromEncodedId(encodedMessageId: string) {
        try {
            const [channel, ts] = encodedMessageId.split("||");
            return new SlackMessageId(channel, ts);
        } catch (e) {
            logger("Received invalid request ID - could not parse.");
            return undefined;
        }
    }

    public channel: string;
    public ts: string;

    constructor(channel: string, ts: string) {
        this.channel = channel;
        this.ts = ts;
    }

    public buildRequestId(): string {
        return `${this.channel}||${this.ts}`;
    }

    public valid() {
        return (this.channel && this.ts);
    }

    public toString() {
        return `channel: ${this.channel}, ts: ${this.ts}`;
    }
}
