import { toEventObject } from 'xstate/lib/utils';
import { ActionTypes } from 'xstate/lib/types';

import {
  BaseActionObject,
  EventObject,
  State,
  StateSchema,
  Typestate,
} from 'xstate';

import {
  ChartReference,
  XJogStateChange,
  XJogStateChangeState,
  XJogActionTypes,
  XJogStateChangeAction,
} from '@samihult/xjog-util';

function mapState<
  TContext = any,
  TStateSchema extends StateSchema = any,
  TEvent extends EventObject = EventObject,
  TTypeState extends Typestate<TContext> = {
    value: any;
    context: TContext;
  },
  TEmitted = any,
>(
  state: State<TContext, TEvent, TStateSchema, TTypeState>,
): XJogStateChangeState {
  return {
    value: JSON.parse(JSON.stringify(state.value)),
    context: JSON.parse(JSON.stringify(state.context)),
    actions: mapActions(state.actions),
  };
}

export function resolveXJogCreateStateChange<
  TContext = any,
  TStateSchema extends StateSchema = any,
  TEvent extends EventObject = EventObject,
  TTypeState extends Typestate<TContext> = {
    value: any;
    context: TContext;
  },
  TEmitted = any,
>(
  ref: ChartReference,
  parentRef: ChartReference | null,
  state: State<TContext, TEvent, TStateSchema, TTypeState>,
): XJogStateChange {
  return {
    type: 'create',
    ref,
    parentRef,
    event: toEventObject(state.event),
    old: null,
    new: mapState(state),
  };
}

export function resolveXJogUpdateStateChange<
  TContext = any,
  TStateSchema extends StateSchema = any,
  TEvent extends EventObject = EventObject,
  TTypeState extends Typestate<TContext> = {
    value: any;
    context: TContext;
  },
  TEmitted = any,
>(
  ref: ChartReference,
  parentRef: ChartReference | null,
  previousState: State<TContext, TEvent, TStateSchema, TTypeState>,
  nextState: State<TContext, TEvent, TStateSchema, TTypeState>,
): XJogStateChange {
  return {
    type: 'update',
    ref,
    parentRef,
    event: toEventObject(nextState.event),
    old: mapState(previousState),
    new: mapState(nextState),
  };
}

export function resolveXJogDeleteStateChange<
  TContext = any,
  TStateSchema extends StateSchema = any,
  TEvent extends EventObject = EventObject,
  TTypeState extends Typestate<TContext> = {
    value: any;
    context: TContext;
  },
  TEmitted = any,
>(
  ref: ChartReference,
  parentRef: ChartReference | null,
  lastState: State<TContext, TEvent, TStateSchema, TTypeState>,
): XJogStateChange {
  return {
    type: 'delete',
    ref,
    parentRef,
    event: null,
    old: mapState(lastState),
    new: null,
  };
}

export function mapActions(
  actions: BaseActionObject[],
): XJogStateChangeAction[] {
  return actions.map((action) => {
    switch (action.type) {
      case ActionTypes.Send:
        return {
          type: ActionTypes.Send,
          sendId: action.id,
          eventType: action._event.name,
          to: action.to,
        };

      case ActionTypes.Cancel:
        return {
          type: ActionTypes.Cancel,
          sendId: action.id,
        };

      case ActionTypes.Start:
        return {
          type: ActionTypes.Start,
          activityId: action.activity.id,
          activityType: action.activity.type,
        };

      case ActionTypes.Stop:
        return {
          type: ActionTypes.Stop,
          activityId: action.activity.id,
          activityType: action.activity.type,
        };

      case ActionTypes.Assign:
      case ActionTypes.Raise:
      case ActionTypes.After:
      case ActionTypes.DoneState:
      case ActionTypes.DoneInvoke:
      case ActionTypes.Log:
      case ActionTypes.Init:
      case ActionTypes.Invoke:
      case ActionTypes.ErrorExecution:
      case ActionTypes.ErrorCommunication:
      case ActionTypes.ErrorPlatform:
      case ActionTypes.ErrorCustom:
      case ActionTypes.Update:
      case ActionTypes.Pure:
      case ActionTypes.Choose:
        return {
          type: action.type,
        };

      default:
        return { type: XJogActionTypes.Unknown, actionType: action.type };
    }
  });
}
