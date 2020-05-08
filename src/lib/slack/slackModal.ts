import {IRequestParams} from "../request";
import moduleInstance from "../../index";
import {View} from "@slack/web-api";
import _ from "lodash";
import {DefaultRequestModalConfig} from "./requestModal";
import {InputBlock, KnownBlock, Option, PlainTextElement} from "@slack/types";

export type FieldType = string;
export const SelectTypeFields: FieldType[] = ["dropdown"];
export const TextFields: FieldType[] = ["text","big_text"];
export const InputFields: FieldType[] = ["text","big_text","dropdown"];

const BaseInputBlock: InputBlock = {
    type: 'input',
    label: {
        type: "plain_text",
        text: "",
        emoji: true
    },
    hint: {
        type: "plain_text",
        text: "",
        emoji: true
    },
    optional: false,
    element: undefined
}

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
     * Initial values are either given as part of the configuration or could be passed in through the
     * request parameters.  During initialization, a derived class may update the initialValues property of
     * the class with "dynamic" initial values that should be inserted into the fields with the right ID.
     * @param f
     */
    protected getFieldInitialValue(f: IModalField): string {
        if (f.initialValue) {
            // In this case, the initial values were set as part of
            //  the configuration object - meaning it's a static value
            //  that is not affected by how and when the request was made.
            return f.initialValue;
        } else if (this.initialValues.hasOwnProperty(f.id)) {

            // In this case, a dynamic value was prepared during the creation
            //  of the modal instance.  It is keyed on the id of the field that
            //  should have the initial value.  The value of that key is the initial
            //  value of the field.
            return this.initialValues[f.id];
        }

        return undefined;
    }

    /**
     * A convenience method to help with generating a simple plain text object for most
     * slack text fields.
     * @param text
     * @param emoji
     */
    protected static getPlainTextOb(text: string, emoji: boolean = true): PlainTextElement {
        return {
            type: "plain_text",
            text: text,
            emoji: emoji
        }
    }

    /**
     * This will convert an array of configured field options into an Slack option object.
     * @param opts
     */
    protected static getSlackOptionsFromConfiguredOptions(opts: IModalFieldOption[]): Option[] {
        return opts.map((o: IModalFieldOption) => {
            return {
                text: {
                    type: "plain_text",
                    text: o.name,
                    emoji: true
                },
                value: o.value,
                description: o.description ? {
                    type: "plain_text",
                    text: o.description.substr(0, 70),
                    emoji: true
                } : undefined
            }
        });
    }

    /**
     * This will convert the IModalField into a slack block configured correctly.  This can be (and should be)
     * overridden for custom field configuration that require more customization that what is provided here.
     * @param f
     */
    protected getSlackBlockFromFieldConfig(f: IModalField): KnownBlock {

        const fieldType = f.type;
        let finalBlock: KnownBlock;

        if (InputFields.includes(fieldType)) {
            finalBlock = _.cloneDeep(BaseInputBlock);
            finalBlock.block_id = f.id;
            finalBlock.label = f.label ? SlackModal.getPlainTextOb(f.label) : undefined;
            finalBlock.hint = f.hint ? SlackModal.getPlainTextOb(f.hint) : undefined;
            finalBlock.optional = !(f.required);

            if (TextFields.includes(fieldType)) {
                finalBlock.element = {
                    type: 'plain_text_input',
                    action_id: f.actionId,
                    placeholder: f.placeholder ? SlackModal.getPlainTextOb(f.placeholder) : undefined,
                    initial_value: this.getFieldInitialValue(f),
                    multiline: (fieldType == "big_text"),
                    min_length: undefined,
                    max_length: undefined
                }
            } else if (fieldType == "dropdown") {
                const sourceOptions = _.isFunction(f.options) ? f.options(this.modalConfig, f) : f.options;
                const options = sourceOptions ? SlackModal.getSlackOptionsFromConfiguredOptions(sourceOptions) : undefined;
                const initialValue = this.getFieldInitialValue(f);
                const initialOption = initialValue ?
                    options ?
                        options.find((o)=>o.value === initialValue)
                        : undefined
                    : undefined;

                finalBlock.element = {
                    action_id: f.actionId,
                    type: 'static_select',
                    placeholder: f.placeholder ? SlackModal.getPlainTextOb(f.placeholder) : undefined,
                    initial_option: initialOption,
                    options: options
                }
            }
        } else if (fieldType == "divider") {
            finalBlock = {
                type: "divider"
            }
        } else {
            throw new Error(`Slack Modal Error: A field type of ${fieldType} could not be found`);
        }

        return finalBlock;
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
            return this.getSlackBlockFromFieldConfig(f);
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
