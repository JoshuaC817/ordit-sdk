import { getAddressesFromPublicKey } from "../addresses"
import { AddressTypes } from "../addresses/formats"
import { OrditApi } from "../api"
import { Network } from "../config/types"
import { Inscription, Ordinal } from "../inscription/types"
import { getWalletKeys } from "../keys"
import { UTXO } from "../transactions/types"

export async function getWallet({
  pubKey,
  network = "testnet",
  format = "all"
}: GetWalletOptions): Promise<GetWalletReturnType> {
  const addresses = getAddressesFromPublicKey(pubKey, network, format)

  return {
    counts: {
      addresses: addresses.length
    },
    keys: [{ pub: pubKey }],
    addresses
  }
}

export async function getWalletWithBalances({ pubKey, format, network, safeMode = "on" }: GetWalletOptions) {
  const wallet = (await getWallet({ pubKey, format, network })) as GetWalletWithBalances

  const ordinals: Ordinal[] = []
  const inscriptions: Inscription[] = []
  const spendables: UTXO[] = []
  const unspendables: UTXO[] = []

  wallet.counts.unspents = 0
  wallet.counts.satoshis = 0
  wallet.counts.cardinals = 0
  wallet.counts.spendables = 0
  wallet.counts.unspendables = 0
  wallet.counts.ordinals = 0
  wallet.counts.inscriptions = 0

  const { addresses } = wallet

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i]

    let wallet_unspents = 0
    let wallet_satoshis = 0
    let wallet_cardinals = 0
    let wallet_spendables = 0
    let wallet_unspendables = 0

    const { totalUTXOs, spendableUTXOs, unspendableUTXOs } = await OrditApi.fetchUnspentUTXOs({
      address: address.address!,
      network,
      type: "all"
    })

    address.unspents = spendableUTXOs.concat(unspendableUTXOs)
    wallet_unspents += totalUTXOs

    for (let j = 0; j < address.unspents!.length; j++) {
      const unspentObj = address.unspents![j]
      unspentObj.pub = address.pub
      wallet.counts.satoshis += unspentObj.sats
      wallet_satoshis += unspentObj.sats

      if (safeMode === "off" || (safeMode === "on" && unspentObj.safeToSpend)) {
        wallet.counts.cardinals += unspentObj.sats
        wallet_cardinals += unspentObj.sats

        wallet.counts.spendables++
        wallet_spendables++
        spendables.push(unspentObj)
      } else {
        wallet.counts.unspendables++
        wallet_unspendables++

        unspendables.push(unspentObj)
      }

      const _ordinals = unspentObj.ordinals
      const _inscriptions = unspentObj.inscriptions

      _ordinals.forEach((_ord: any, index: number) => {
        _ordinals[index].address = address
        _ordinals[index].unspent = unspentObj.txid

        ordinals.push(_ord)
      })

      _inscriptions.forEach((_inscription: any, index: number) => {
        _inscriptions[index].address = address
        _inscriptions[index].unspent = unspentObj.txid

        inscriptions.push(_inscription)
      })

      wallet.spendables = spendables
      wallet.unspendables = unspendables
      wallet.ordinals = ordinals
      wallet.inscriptions = inscriptions
      wallet.counts.ordinals = ordinals.length
      wallet.counts.inscriptions = inscriptions.length

      address.counts = {
        unspents: wallet_unspents,
        satoshis: wallet_satoshis,
        cardinals: wallet_cardinals,
        spendables: wallet_spendables,
        unspendables: wallet_unspendables
      }
    }
  }

  return wallet
}

export type OnOffUnion = "on" | "off"

export type GetWalletOptions = {
  pubKey: string
  network: Network
  format: AddressTypes | "all"
  safeMode?: OnOffUnion
}

export type GetWalletReturnType = {
  counts: {
    addresses: number
  }
  keys: [Partial<Awaited<ReturnType<typeof getWalletKeys>>>]
  addresses: ReturnType<typeof getAddressesFromPublicKey>
}

export type GetWalletWithBalances = GetWalletReturnType & {
  spendables: UTXO[]
  unspendables: UTXO[]
  ordinals: Ordinal[]
  inscriptions: Inscription[]

  counts: {
    unspents: number
    satoshis: number
    cardinals: number
    spendables: number
    unspendables: number
    ordinals: number
    inscriptions: number
  }
  addresses: Array<{
    unspents: any[]
    counts: {
      unspents: number
      satoshis: number
      cardinals: number
      spendables: number
      unspendables: number
    }
  }>
}
