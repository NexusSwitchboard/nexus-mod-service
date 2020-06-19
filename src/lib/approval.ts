import {NexusModule} from "@nexus-switchboard/nexus-extend";

export interface IServiceApprovalConfig {
    [index: string]: IServiceApproval
}

export interface IServiceApproval {

    /// EVENT CONDITIONS
    //  Notice that there are three ways to filter events that this transition handler will handle.
    //  1. From: The FROM status of the issue must be named this (case insensitive)
    //  2. To: The TO status of the issue must be named this (case insensitive)
    //  3. jql: The JQL that filters out events for tickets that do not match this JQL.
    //
    //  For example, to get notified of tickets that are marked Done in the TOOL project, you would
    //  set it up like this:
    //  {
    //      from: undefined,
    //      to: "Done",
    //      jql: "project in (TOOL)",
    //      onTransition(): void => { // DO STUFF };
    //  }

    // This is the status that is viewed as the trigger for starting the approval process.  This can be
    //  combined with the jql trigger property to refine specifically what tickets will be subject
    //  to this approval process
    triggerStatus?: string;
    triggerJql?: string;

    // This is the transition that will be executed if approval has been given. This
    //  is not required because the approval handler might make its own changes to the issue to indicate
    //  approval that have nothing to do with a status change.
    approvalTransitionId?: string;

    // This is the transition that will be executed if approval has NOT been given. This
    //  is not required because the denial handler might make its own changes to the issue to indicate
    //  the denial state or you simply may not do anything after denial. If the denial transition leads to a
    //  "Done" type status, then the resolution name can must also be given.
    denialTransitionId?: string;
    denialResolutionName?: string;

    // These are the people who can be approvers.  The email(s) here will be used to identify the
    //  slack user using the `users.lookupByEmail` api call.  They will each get a DM with an approval
    //  button.  Note that if there are no approvers here then the approval message will be sent to the
    //  primary request channel thread and can be approved by anyone.
    approvers?: [string];

    // This is the message that is sent to an approver along with a button to approve.
    approvalRequestMsg?: string;

    // This is the message that is sent to the primary channel's request thread to indicate
    //  approval has been given.  Available variables are:
    //      {{approver}}
    //      {{reporter}}
    approvalGivenMsg?: string;

    // This is the message that is sent to the primary channel's request thread to indicate
    //  that the approval was denied.
    //      {{approver}}
    //      {{reporter}}
    approvalDeniedMsg: string;

    // this is called after a user has approved the request.  Note that you do not need to specify
    //  an action here.  Instead, if the approvalTransitionId is set then that transition will be
    //  executed and the approval message will be displayed as described above.
    onApproved?: (moduleInstance: NexusModule) => void;

    // This is called after a user has denied a request.  You can use this to transition to a denied
    //  state in Jira or send a message in slack.
    onDenied?: (moduleInstance: NexusModule) => void;
}
