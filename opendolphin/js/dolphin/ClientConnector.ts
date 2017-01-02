import AttributeMetadataChangedCommand from "./AttributeMetadataChangedCommand";
import CallNamedActionCommand from "./CallNamedActionCommand";
import { ClientAttribute } from "./ClientAttribute";
import ClientDolphin from "./ClientDolphin";
import { ClientPresentationModel } from "./ClientPresentationModel";
import Codec from "./Codec";
import Command from "./Command";
import { BlindCommandBatcher, CommandBatcher } from "./CommandBatcher";
import CreatePresentationModelCommand from "./CreatePresentationModelCommand";
import DataCommand from "./DataCommand";
import DeleteAllPresentationModelsOfTypeCommand from "./DeleteAllPresentationModelsOfTypeCommand";
import DeletePresentationModelCommand from "./DeletePresentationModelCommand";
import InitializeAttributeCommand from "./InitializeAttributeCommand";
import NamedCommand from "./NamedCommand";
import SignalCommand from "./SignalCommand";
import SwitchPresentationModelCommand from "./SwitchPresentationModelCommand";
import ValueChangedCommand from "./ValueChangedCommand";


export interface OnSuccessHandler {
    onSuccess():void
}

export interface OnFinishedHandler {
    onFinished(models: ClientPresentationModel[]):void
    onFinishedData(listOfData:any[]):void
}

export interface CommandAndHandler {
    command :  Command;
    handler : OnFinishedHandler;
}

export interface Transmitter {
    transmit(commands: Command[], onDone:(result: Command[]) => void) : void ;
    signal(command: SignalCommand) : void;
    reset(successHandler:OnSuccessHandler): void;
}

export class ClientConnector {

    private commandQueue :      CommandAndHandler[] = [];
    private currentlySending :  boolean = false;
    private slackMS:            number; // slack milliseconds for rendering and batching
    private transmitter :       Transmitter;
    private codec :              Codec;
    private clientDolphin :      ClientDolphin;
    private commandBatcher:      CommandBatcher;

    /////// push support state  ///////
    private pushListener:        NamedCommand;
    private releaseCommand:      SignalCommand;
    private pushEnabled:        boolean = false;
    private waiting:            boolean = false;


    constructor(transmitter:Transmitter, clientDolphin: ClientDolphin, slackMS: number = 0, maxBatchSize : number = 50) {
        this.transmitter = transmitter;
        this.clientDolphin = clientDolphin;
        this.slackMS = slackMS;
        this.codec = new  Codec();
        this.commandBatcher = new BlindCommandBatcher(true, maxBatchSize);
    }

    setCommandBatcher(newBatcher:  CommandBatcher) {
        this.commandBatcher = newBatcher;
    }
    setPushEnabled(enabled:boolean) {
        this.pushEnabled = enabled;
    }
    setPushListener(newListener:  NamedCommand) {
        this.pushListener = newListener
    }
    setReleaseCommand(newCommand:  SignalCommand) {
        this.releaseCommand = newCommand
    }

    reset(successHandler:OnSuccessHandler) {
        this.transmitter.reset(successHandler);
    }

    send(command: Command, onFinished:OnFinishedHandler) {
        this.commandQueue.push({command: command, handler: onFinished });
        if (this.currentlySending) {
            this.release(); // there is not point in releasing if we do not send atm
            return;
        }
        this.doSendNext();
    }

    private doSendNext() {
        if (this.commandQueue.length < 1) {
            if (this.pushEnabled) {
                this.enqueuePushCommand();
            } else {
                this.currentlySending = false;
                return;
            }
        }
        this.currentlySending = true;

        var cmdsAndHandlers = this.commandBatcher.batch(this.commandQueue);
        var callback = cmdsAndHandlers[cmdsAndHandlers.length-1].handler;
        var commands = cmdsAndHandlers.map( cah => { return cah.command });
        this.transmitter.transmit(commands, (response: Command[]) => {

            //console.log("server response: [" + response.map(it => it.id).join(", ") + "] ");

            var touchedPMs :  ClientPresentationModel[] = []
            response.forEach((command: Command) => {
                var touched = this.handle(command);
                if (touched) touchedPMs.push(touched);
            });

            if (callback) {
                callback.onFinished(touchedPMs); // todo: make them unique?
                // todo dk: handling of data from datacommand
            }

            // recursive call: fetch the next in line but allow a bit of slack such that
            // document events can fire, rendering is done and commands can batch up
            setTimeout( () => this.doSendNext() , this.slackMS );
        });
    }



    handle(command: Command):  ClientPresentationModel{
        if(command.id == "Data"){
            return this.handleDataCommand(< DataCommand>command);
        }else if(command.id == "DeletePresentationModel"){
            return this.handleDeletePresentationModelCommand(< DeletePresentationModelCommand>command);
        }else if(command.id == "DeleteAllPresentationModelsOfType"){
            return this.handleDeleteAllPresentationModelOfTypeCommand(< DeleteAllPresentationModelsOfTypeCommand>command);
        }else if(command.id == "CreatePresentationModel"){
            return this.handleCreatePresentationModelCommand(< CreatePresentationModelCommand>command);
        }else if(command.id == "ValueChanged"){
            return this.handleValueChangedCommand(< ValueChangedCommand>command);
        }else if(command.id == "SwitchPresentationModel"){
            return this.handleSwitchPresentationModelCommand(< SwitchPresentationModelCommand>command);
        }else if(command.id == "InitializeAttribute"){
            return this.handleInitializeAttributeCommand(< InitializeAttributeCommand>command);
        }else if(command.id == "AttributeMetadataChanged"){
            return this.handleAttributeMetadataChangedCommand(< AttributeMetadataChangedCommand>command);
        }else if(command.id == "CallNamedAction"){
            return this.handleCallNamedActionCommand(< CallNamedActionCommand>command);
        }else{
            console.log("Cannot handle, unknown command "+command);
        }

        return null;
    }
    private handleDataCommand(serverCommand:  DataCommand): any{
        return serverCommand.data;
    }
    private handleDeletePresentationModelCommand(serverCommand: DeletePresentationModelCommand): ClientPresentationModel{
        var model: ClientPresentationModel =  this.clientDolphin.findPresentationModelById(serverCommand.pmId);
        if(!model) return null;
        this.clientDolphin.getClientModelStore().deletePresentationModel(model, true);
        return model;
    }
    private handleDeleteAllPresentationModelOfTypeCommand(serverCommand: DeleteAllPresentationModelsOfTypeCommand){
        this.clientDolphin.deleteAllPresentationModelOfType(serverCommand.pmType);
        return null;
    }
    private handleCreatePresentationModelCommand(serverCommand: CreatePresentationModelCommand): ClientPresentationModel{
        if(this.clientDolphin.getClientModelStore().containsPresentationModel(serverCommand.pmId)){
            throw new Error("There already is a presentation model with id "+serverCommand.pmId+"  known to the client.");
        }
        var attributes: ClientAttribute[] = [];
        serverCommand.attributes.forEach((attr) =>{
            var clientAttribute = this.clientDolphin.attribute(attr.propertyName,attr.qualifier,attr.value);
            if(attr.id && attr.id.match(".*S$")) {
                clientAttribute.id = attr.id;
            }
            attributes.push(clientAttribute);
        });
        var clientPm = new  ClientPresentationModel(serverCommand.pmId, serverCommand.pmType);
        clientPm.addAttributes(attributes);
        if(serverCommand.clientSideOnly){
            clientPm.clientSideOnly = true;
        }
        this.clientDolphin.getClientModelStore().add(clientPm);
        this.clientDolphin.updatePresentationModelQualifier(clientPm);
        return clientPm;
    }
    private handleValueChangedCommand(serverCommand: ValueChangedCommand): ClientPresentationModel{
        var clientAttribute:  ClientAttribute = this.clientDolphin.getClientModelStore().findAttributeById(serverCommand.attributeId);
        if(!clientAttribute){
            console.log("attribute with id "+serverCommand.attributeId+" not found, cannot update old value "+serverCommand.oldValue+" to new value "+serverCommand.newValue);
            return null;
        }
        if (clientAttribute.getValue() == serverCommand.newValue) {
            //console.log("nothing to do. new value == old value");
            return null;
        }
        // Below was the code that would enforce that value changes only appear when the proper oldValue is given.
        // While that seemed appropriate at first, there are actually valid command sequences where the oldValue is not properly set.
        // We leave the commented code in the codebase to allow for logging/debugging such cases.
//            if(clientAttribute.getValue() != serverCommand.oldValue) {
//                console.log("attribute with id "+serverCommand.attributeId+" and value " + clientAttribute.getValue() +
//                            " was set to value " + serverCommand.newValue + " even though the change was based on an outdated old value of " + serverCommand.oldValue);
//            }
        clientAttribute.setValue(serverCommand.newValue);
        return null;
    }
    private handleSwitchPresentationModelCommand(serverCommand: SwitchPresentationModelCommand): ClientPresentationModel{
        var switchPm: ClientPresentationModel = this.clientDolphin.getClientModelStore().findPresentationModelById(serverCommand.pmId);
        if(!switchPm){
            console.log("switch model with id "+serverCommand.pmId+" not found, cannot switch.");
            return null;
        }
        var sourcePm = this.clientDolphin.getClientModelStore().findPresentationModelById(serverCommand.sourcePmId);
        if(!sourcePm){
            console.log("source model with id "+serverCommand.sourcePmId+" not found, cannot switch.");
            return null;
        }
        switchPm.syncWith(sourcePm);
        return switchPm;
    }
    private handleInitializeAttributeCommand(serverCommand:  InitializeAttributeCommand): ClientPresentationModel{
        var attribute = new  ClientAttribute(serverCommand.propertyName,serverCommand.qualifier,serverCommand.newValue);
        if(serverCommand.qualifier){
            var attributesCopy: ClientAttribute[]= this.clientDolphin.getClientModelStore().findAllAttributesByQualifier(serverCommand.qualifier);
            if(attributesCopy){
                if(!serverCommand.newValue){
                    var attr = attributesCopy.shift();
                    if(attr){
                        attribute.setValue(attr.getValue());
                    }
                }else{
                    attributesCopy.forEach(attr =>{
                        attr.setValue(attribute.getValue());
                    });
                }
            }
        }
        var presentationModel:  ClientPresentationModel;
        if(serverCommand.pmId){
            presentationModel = this.clientDolphin.getClientModelStore().findPresentationModelById(serverCommand.pmId);
        }
        if(!presentationModel){
            presentationModel = new  ClientPresentationModel(serverCommand.pmId,serverCommand.pmType);
            this.clientDolphin.getClientModelStore().add(presentationModel);
        }
        this.clientDolphin.addAttributeToModel(presentationModel,attribute);
        this.clientDolphin.updatePresentationModelQualifier(presentationModel);
        return presentationModel;
    }
    private handleAttributeMetadataChangedCommand(serverCommand:  AttributeMetadataChangedCommand):  ClientPresentationModel{
        var clientAttribute = this.clientDolphin.getClientModelStore().findAttributeById(serverCommand.attributeId);
        if(!clientAttribute) return null;
        clientAttribute[serverCommand.metadataName] = serverCommand.value
        return null;
    }
    private handleCallNamedActionCommand(serverCommand:  CallNamedActionCommand):  ClientPresentationModel{
        this.clientDolphin.send(serverCommand.actionName,null);
        return null;
    }


    ///////////// push support ///////////////

    listen() : void {
        if (! this.pushEnabled) return;
        if (this.waiting) return;
        // todo: how to issue a warning if no pushListener is set?
        if (! this.currentlySending) {
            this.doSendNext();
        }
    }

    private enqueuePushCommand() : void {
        var me = this;
        this.waiting = true;
        this.commandQueue.push({
            command: this.pushListener,
            handler: {
                onFinished: function(models) { me.waiting = false; },
                onFinishedData: null
            }
        });
    }

    release() : void {
        if (! this.waiting) return;
        this.waiting = false;
        // todo: how to issue a warning if no releaseCommand is set?
        this.transmitter.signal(this.releaseCommand);
    }

}
