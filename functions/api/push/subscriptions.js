import {
  handleSubscriptionDelete,
  handleSubscriptionPut,
} from "../../../cloudflare/push.js";

export const onRequestPut = handleSubscriptionPut;
export const onRequestDelete = handleSubscriptionDelete;
