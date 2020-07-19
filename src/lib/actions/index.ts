import {FlowAction, FlowSource} from "../flows";
import ServiceRequest from "../request";
import {JiraConnection} from "@nexus-switchboard/nexus-conn-jira";
import {SlackConnection} from "@nexus-switchboard/nexus-conn-slack";
import {ModuleConfig} from "@nexus-switchboard/nexus-core";
import {ServiceIntent} from "../intents";

export abstract class Action {
    protected readonly jira: JiraConnection;
    protected readonly slack: SlackConnection;
    protected readonly intent: ServiceIntent;
    protected readonly config: ModuleConfig;
    protected readonly payload: any;
    protected readonly additionalData: any;
    protected readonly source: FlowSource;

    public constructor(options: {source?: FlowSource, payload?: any, additionalData?: any, intent: ServiceIntent}) {
        this.intent = options.intent;
        this.jira = options.intent.module.getJira();
        this.slack = options.intent.module.getSlack();
        this.config = options.intent.module.getActiveModuleConfig();
        this.payload = options.payload;
        this.additionalData = options.additionalData;
        this.source = options.source;
    }
    /**
     * Returns the code for the action.  Every action MUST have a unique code.
     */
    public abstract getType(): FlowAction;

    /**
     * This is called immediately after a request has changed to this state.  Expect it
     * to be called exactly once after each state change.  This can be used to notify
     * users after changes have been made to state.
     */
    public abstract async postRun(request: ServiceRequest): Promise<ServiceRequest>;

    /**
     * This is where the execution of the action happens
     */
    public abstract async run(request: ServiceRequest): Promise<ServiceRequest>;

    /**
     * This is called prior to the state changing.  Note that this is guaranteed to
     * return immediately (within 1 second).  PreChangeState can be used to send UI feedback
     * to the client.
     */
    public abstract preRun(request: ServiceRequest): ServiceRequest;

}
