import { EventObject, StateValue } from 'xstate';
import { ActionTypes } from 'xstate/lib/types';

import { XJogActionTypes } from './XJogActionTypes';
import { ChartReference } from './ChartReference';

export type XJogStateChangeSendAction = {
  type: ActionTypes.Send;
  sendId: string | number;
  eventType: string;
  to: string;
};

export type XJogStateChangeRaiseAction = {
  type: ActionTypes.Raise;
  // TODO ?
};

export type XJogStateChangeCancelAction = {
  type: ActionTypes.Cancel;
  sendId: string | number;
  // TODO ?
};

export type XJogStateChangeStartAction = {
  type: ActionTypes.Start;
  activityId: string;
  activityType: string;
};

export type XJogStateChangeStopAction = {
  type: ActionTypes.Stop;
  activityId: string;
  activityType: string;
};

export type XJogStateChangeAssignAction = {
  type: ActionTypes.Assign;
  // TODO ?
};

export type XJogStateChangeAfterAction = {
  type: ActionTypes.After;
  // TODO ?
};

export type XJogStateChangeDoneStateAction = {
  type: ActionTypes.DoneState;
  // TODO ?
};

export type XJogStateChangeDoneInvokeAction = {
  type: ActionTypes.DoneInvoke;
  // TODO ?
};

export type XJogStateChangeLogAction = {
  type: ActionTypes.Log;
  // TODO ?
};

export type XJogStateChangeInitAction = {
  type: ActionTypes.Init;
  // TODO ?
};

export type XJogStateChangeInvokeAction = {
  type: ActionTypes.Invoke;
  // TODO ?
};

export type XJogStateChangeErrorExecutionAction = {
  type: ActionTypes.ErrorExecution;
  // TODO ?
};

export type XJogStateChangeErrorCommunicationAction = {
  type: ActionTypes.ErrorCommunication;
  // TODO ?
};

export type XJogStateChangeErrorPlatformAction = {
  type: ActionTypes.ErrorPlatform;
  // TODO ?
};

export type XJogStateChangeErrorCustomAction = {
  type: ActionTypes.ErrorCustom;
  // TODO ?
};

export type XJogStateChangeUpdateAction = {
  type: ActionTypes.Update;
  // TODO ?
};

export type XJogStateChangePureAction = {
  type: ActionTypes.Pure;
  // TODO ?
};

export type XJogStateChangeChooseAction = {
  type: ActionTypes.Choose;
  // TODO ?
};

export type XJogStateChangeUnknownAction = {
  type: XJogActionTypes.Unknown;
  actionType: string;
};

export type XJogStateChangeAction =
  | XJogStateChangeSendAction
  | XJogStateChangeRaiseAction
  | XJogStateChangeCancelAction
  | XJogStateChangeStartAction
  | XJogStateChangeStopAction
  | XJogStateChangeAssignAction
  | XJogStateChangeAfterAction
  | XJogStateChangeDoneStateAction
  | XJogStateChangeDoneInvokeAction
  | XJogStateChangeLogAction
  | XJogStateChangeInitAction
  | XJogStateChangeInvokeAction
  | XJogStateChangeErrorExecutionAction
  | XJogStateChangeErrorCommunicationAction
  | XJogStateChangeErrorPlatformAction
  | XJogStateChangeErrorCustomAction
  | XJogStateChangeUpdateAction
  | XJogStateChangePureAction
  | XJogStateChangeChooseAction
  | XJogStateChangeUnknownAction;

export type XJogStateChangeState = {
  value: StateValue;
  context: any;
  actions: XJogStateChangeAction[];
};

export type XJogStateChange = {
  type: 'create' | 'update' | 'delete';
  ref: ChartReference;
  parentRef: ChartReference | null;
  event: EventObject | null;
  old: XJogStateChangeState | null;
  new: XJogStateChangeState | null;
};
