import {IRequestParams} from "../request";
import moduleInstance from "../../index";
import {View} from "@slack/web-api";
import _ from "lodash";
import {DefaultRequestModalConfig} from "./requestModal";

export type FieldType = "text" | "big_text" | "dropdown" | "divider";
export const SelectTypeFields: FieldType[] = ["dropdown"];
export const LabeledFields: FieldType[] = ["text","big_text","dropdown"];
export const TextFields: FieldType[] = ["text","big_text"];
export const InputFields: FieldType[] = ["text","big_text","dropdown"];

const FieldNameToSlackFieldMap: Record<FieldType, any> = {
    text: {
        type: "input",
        elementType: "plain_text_input",
    },
    big_text: {
        type: "input",
        elementType: "plain_text_input",
    },
    dropdown: {
        type: "input",
        elementType: "static_select",
    },
    divider: {
        type: "divider",
    }

    // NOTE: To add more types, do this:
    //  1. Add the new type name to the FieldType type.
    //  2. Add a new key to the FieldNameToSlackFieldMap constant that has a value
    //      which contains the UNIQUE/VARIABLE parts of that block's slack representation.
};

export interface IModalText {
    label?: string,
    hint?: string
}

export interface IModalFieldOption {
    name: string,
    value: string,
    description?: string
}
export interface IModalConfig {
    title?: string,
    description?: string,
    configurableFields: IModalField[],
    actionButtons: {
        submit: IModalText,
        cancel: IModalText
    }
}

export type GetOptionsFunc = (modal: IModalConfig, field: IModalField) => IModalFieldOption[];
export interface IModalField {
    id: string,
    label: string,
    hint?: string,
    placeholder?: string,
    actionId?: string,
    required: boolean,
    position: number,
    type: FieldType,
    options?: IModalFieldOption[] | GetOptionsFunc,
    initialValue?: string,
    ticketFieldId: string
}

/**
 * A generalized modal class that can build slack modals based on a simplified
 * configuration.  It abstracts away the specific implementation details of the
 * slack block building and provides a simplified method for showing the modal.
 *
 * The _init method is called from the base class constructor AFTER all the input
 * has been stored in class properties.  This allows the derived class to do additional
 * initialization such as setting the class's initialValues to something other than
 * an empty object.  That's useful when the initialValues cannot be part of the static
 * config because they are based on input from the user at runtime.
 *
 * The generate method is where the construction of the dialog happens.  Note that
 * you can override this and call the base class if you need to make specific modifications
 * to the output that are not supported by the class.
 *
 * The show method takes care of actually displaying the dialog.  Remember that
 * dialog views cannot only be shown within a short time period after the trigger was
 * created.  So avoid making external calls to APIs during the init or generate phase
 * of the modal creation.
 */
export default class SlackModal {

    modalConfig: IModalConfig;
    requestInfo: IRequestParams;
    contextIdentifier: string;
    initialValues: Record<string, string>;

    constructor(
        requestInfo: IRequestParams,
        modalConfig: IModalConfig,
        contextIdentifier?: string) {

        this.requestInfo = requestInfo;
        this.modalConfig = modalConfig || DefaultRequestModalConfig
        this.contextIdentifier = contextIdentifier;
        this.initialValues = {};

        this._init();
    }

    /**
     * This should be overridden by the deriving class to do any kind
     * of initialization necessary (such as setting initialValues based
     * on stored metadata).
     * @private
     */
    protected _init(): void {
        // PASS
    }

    /**
     * Sends a message to Slack to show the modal as configured by the input parameters given in the constructor.
     * @param triggerId The slack ID of the trigger that allows this modal to be shown.  This trigger had to have been
     *          generated in the last second (or less).
     */
    public async show(triggerId: string): Promise<boolean> {
        const modal = await moduleInstance.getSlack().apiAsBot.views.open({
            trigger_id: triggerId,
            view: this.generate()
        });
        return modal.ok;
    }

    /**
     * Generates the View JSON required to be passed to the view open call.
     */
    protected generate(): View {
        // Setup the basic parts of the view object
        const view: View = {
            type: "modal",
            callback_id: "infra_request_modal",
            private_metadata: this.contextIdentifier,
            notify_on_close: true,
            title: {
                type: "plain_text",
                text: this.modalConfig.title,
                emoji: true
            },
            submit: {
                type: "plain_text",
                text: this.modalConfig.actionButtons.submit.label
            },
            close: {
                type: "plain_text",
                text: this.modalConfig.actionButtons.cancel.label
            },
            blocks: []
        };

        // Now add the blocks based on the requested fields.
        view.blocks = this.modalConfig.configurableFields.map((f: IModalField) => {
            const fieldOb: any = FieldNameToSlackFieldMap ?
                { type: FieldNameToSlackFieldMap[f.type].type} : undefined;

            if (!fieldOb) {
                throw new Error(`Unable to add a field of type ${f.type} - unrecognized`);
            }

            fieldOb.block_id = f.id;

            if (f.label && LabeledFields.indexOf(f.type) > -1) {
                fieldOb.label = {
                    type: "plain_text",
                    text: f.label,
                    emoji: true
                }
            }

            if (InputFields.indexOf(f.type) > -1) {
                fieldOb.optional = !(f.required);

                if (f.hint) {
                    fieldOb.hint = {
                        type: "plain_text",
                        text: f.hint
                    }
                }

                fieldOb.element = {
                    action_id: f.actionId,
                    type: FieldNameToSlackFieldMap[f.type].elementType,
                }

                // If this is a choice type of input, then there will
                //  be an options field that needs to be filled out.  The options
                //  can be either a static list of option objects or a function that
                //  generates the list on the fly.
                if (SelectTypeFields.indexOf(f.type) > -1) {
                    const options = _.isFunction(f.options) ? f.options(this.modalConfig, f) : f.options;
                    fieldOb.element.options = options.map((o) => {
                        return {
                            text: {
                                type: "plain_text",
                                text: o.name,
                                emoji: true
                            },
                            value: o.value,
                            description: o.description ? {
                                type: "plain_text",
                                text: o.description,
                                emoji: true
                            } : undefined
                        }
                    })
                }

                if (TextFields.indexOf(f.type) > -1) {
                    fieldOb.element.multiline = (f.type === "big_text");
                }

                if (f.placeholder) {
                    fieldOb.element.placeholder = {
                        type: "plain_text",
                        text: f.placeholder,
                        emoji: true
                    }
                }

                // Initial values can be either set at the time that the configuration
                //  object is created - think of these as "static" values.  Or they
                //  can be set at the time the modal is about to be created.  You would
                //  do the latter in cases where the circumstances that led to the creation
                //  of the modal included some input that can be prepopulated in the dialog
                //  to save the user some time.

                if (f.initialValue) {
                    // In this case, the initial values were set as part of
                    //  the configuration object - meaning it's a static value
                    //  that is not affected by how and when the request was made.
                    fieldOb.element.initial_value = f.initialValue;
                } else if (this.initialValues.hasOwnProperty(f.id)) {

                    // In this case, a dynamic value was prepared during the creation
                    //  of the modal instance.  It is keyed on the id of the field that
                    //  should have the initial value.  The value of that key is the initial
                    //  value of the field.
                    fieldOb.element.initial_value = this.initialValues[f.id];
                }
            }

            return fieldOb;
        });

        // Now add the modal description area and the divider following it (to the beginning
        //  of the block list.  We do it afterwards just so we're not concating an array
        //  afterwards.  Not sure which is faster or better way of doing things.
        view.blocks.unshift({
            type: "section",
            text: {
                type: "plain_text",
                text: this.modalConfig.description,
                emoji: true
            }
        }, {
            type: "divider"
        });


        return view;
    }
};
