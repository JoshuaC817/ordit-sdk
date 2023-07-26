import { GetWalletOptions, OrditApi, OrdTransaction, verifyMessage } from "..";
import { Network } from "../config/types";

export async function publishCollection({
  title,
  description,
  url,
  slug,
  creator,
  publishers,
  inscriptions,
  ...options
}: PublishCollectionOptions) {
  if (!validateInscriptions(inscriptions)) {
    throw new Error("Invalid inscriptions supplied.");
  }

  const collectionMeta = {
    p: "vord", // protocol
    v: 1, // version
    ty: "col",
    title: title,
    desc: description,
    url: url,
    slug: slug,
    creator: creator,
    publ: publishers,
    insc: inscriptions
  };

  return new OrdTransaction({ ...options, meta: collectionMeta });
}

export async function mintFromCollection(options: MintFromCollectionOptions) {
  if (!options.collectionOutpoint || !options.inscriptionIid || !options.destination) {
    throw new Error("Invalid options supplied.");
  }

  let colTxId = null;
  let colVOut = null;

  try {
    [colTxId, colVOut] = options.collectionOutpoint.split(":");
  } catch (error) {
    throw new Error(error);
  }

  if (!colTxId || !colVOut) {
    throw new Error("Invalid collection outpoint supplied.");
  }

  try {
    const tx = await OrditApi.fetch<{
      success: boolean;
      rdata: any;
      message?: string;
    }>("utxo/transaction", {
      data: {
        txid: colTxId,
        options: {
          noord: false,
          nohex: false,
          nowitness: false
        }
      },
      network: options.network || "testnet"
    });

    if (!tx.success) {
      throw new Error("Failed to get raw transaction for id: " + colTxId);
    }

    const colMeta = tx.rdata.vout[colVOut].inscriptions[0].meta;

    let validInscription = false;

    for (let i = 0; i < colMeta.insc.length; i++) {
      if (
        colMeta.insc[i].iid == options.inscriptionIid &&
        colMeta.publ[options.publisherIndex] &&
        options.nonce < colMeta.insc[i].lim
      ) {
        validInscription = true;
      }
    }

    if (!validInscription) {
      throw new Error("Invalid inscription iid supplied.");
    }

    const meta: any = {
      p: "vord",
      v: 1,
      ty: "insc",
      col: options.collectionOutpoint,
      iid: options.inscriptionIid,
      publ: colMeta.publ[options.publisherIndex],
      nonce: options.nonce,
      traits: options.traits
    };

    const message = options.collectionOutpoint + " " + options.inscriptionIid + " " + options.nonce;
    const validSignature = verifyMessage({ address: meta.publ, message: message, signature: options.signature });

    if (!validSignature) {
      throw new Error("Invalid signature supplied.");
    }

    meta.sig = options.signature;

    return new OrdTransaction({ ...options, meta });
  } catch (error) {
    throw new Error(error);
  }
}

function validateInscriptions(inscriptions: CollectionInscription[] = []) {
  if (!inscriptions.length) return false;

  for (const insc of inscriptions) {
    if (!insc.iid || !insc.lim) {
      return false;
    }
  }

  return true;
}

export type PublishCollectionOptions = Pick<GetWalletOptions, 'safeMode'> & {
  feeRate?: number;
  postage?: number;
  mediaType?: string;
  mediaContent: string;
  destination: string;
  changeAddress: string;
  title: string;
  description: string;
  slug: string;
  url: string;
  publishers: Array<string>;
  inscriptions: Array<CollectionInscription>;
  creator: {
    name?: string;
    email?: string;
    address: string;
  };
  network?: Network;
  publicKey: string;
  outs?: Outputs;
};

export type CollectionInscription = {
  iid: string;
  lim: number;
  sri?: string;
};

export type MintFromCollectionOptions = Pick<GetWalletOptions, 'safeMode'> & {
  feeRate?: number;
  postage?: number;
  mediaType?: string;
  mediaContent: string;
  destination: string;
  changeAddress: string;
  collectionOutpoint: string;
  inscriptionIid: string;
  nonce: number;
  publisherIndex: number;
  signature: string;
  network?: Network;
  publicKey: string;
  outs?: Outputs;
  traits?: Record<string, string>
};

type Outputs = Array<{ address: string; value: number }>;
