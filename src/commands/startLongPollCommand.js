import {START_LONG_POLL_COMMAND_NAME} from './commandConstants'

export default class StartLongPollCommand {

    constructor() {
        this.id = START_LONG_POLL_COMMAND_NAME;
    }
}
