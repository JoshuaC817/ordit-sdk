import * as addresses from "./addresses"
import * as api from "./api"
import * as metamask from "./browser-wallets/metamask"
import * as unisat from "./browser-wallets/unisat"
import * as xverse from "./browser-wallets/xverse"
import * as config from "./config"
import * as inscription from "./inscription"
import * as keys from "./keys"
import * as signatures from "./signatures"
import * as transactions from "./transactions"
import * as utils from "./utils"
import * as wallet from "./wallet"

export const ordit = {
  config,
  api,
  addresses,
  wallet,
  keys,
  signatures,
  transactions,
  inscription,
  utils,
  unisat,
  xverse,
  metamask
}

export * from "./addresses"
export * from "./api"
export * as metamask from "./browser-wallets/metamask"
export * as unisat from "./browser-wallets/unisat"
export * as xverse from "./browser-wallets/xverse"
export * from "./config"
export * from "./inscription"
export * from "./keys"
export * from "./signatures"
export * from "./transactions"
export * from "./utils"
export * from "./wallet"
export { Ordit } from "./wallet/Ordit"
