
export class SlackMessageId {

    public channel: string;
    public ts: string;

    constructor(channel: string, ts: string) {
        this.channel = channel;
        this.ts = ts;
    }

    public valid() {
        return (this.channel && this.ts);
    }

    public toString() {
        return `channel: ${this.channel}, ts: ${this.ts}`;
    }
}
