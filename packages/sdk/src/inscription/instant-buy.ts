import * as bitcoin from "bitcoinjs-lib";

import {
  AddressFormats,
  addressNameToType,
  AddressTypes,
  calculateTxFeeWithRate,
  createTransaction,
  getAddressesFromPublicKey,
  getNetwork,
  OrditApi,
  toXOnly
} from "..";
import { Network } from "../config/types";

export async function generateSellerPsbt({
  inscriptionOutPoint,
  price,
  receiveAddress,
  publicKey,
  pubKeyType = "taproot",
  network = "testnet"
}: GenerateSellerInstantBuyPsbtOptions) {
  const { inputs, outputs } = await getSellerInputsOutputs({
    inscriptionOutPoint,
    price,
    receiveAddress,
    publicKey,
    pubKeyType,
    network
  });

  const networkObj = getNetwork("testnet");
  const psbt = new bitcoin.Psbt({ network: networkObj });

  psbt.addInput(inputs[0]);
  psbt.addOutput(outputs[0]);

  return psbt;
}

export async function generateBuyerPsbt({
  publicKey,
  pubKeyType = "legacy",
  feeRate = 10,
  network = "testnet",
  sellerPsbt,
  inscriptionOutPoint
}: GenerateBuyerInstantBuyPsbtOptions) {
  const networkObj = getNetwork(network);
  const format = addressNameToType[pubKeyType];
  const address = getAddressesFromPublicKey(publicKey, network, format)[0];
  let postage = 10000; // default postage
  let ordOutNumber = 0;
  // get postage from outpoint

  try {
    const [ordTxId, ordOut] = inscriptionOutPoint.split(":");
    if (!ordTxId || !ordOut) {
      throw new Error("Invalid outpoint.");
    }

    ordOutNumber = parseInt(ordOut);
    const { tx } = await OrditApi.fetchTx({ txId: ordTxId, network })
    if (!tx) {
      throw new Error("Failed to get raw transaction for id: " + ordTxId);
    }

    const output = tx && tx.vout[ordOutNumber];

    if (!output) {
      throw new Error("Outpoint not found.");
    }

    postage = output.value * 1e8;
  } catch (error) {
    throw new Error(error.message);
  }

  const { totalUTXOs, spendableUTXOs } = await OrditApi.fetchUnspentUTXOs({ address: address.address!, network })
  if (!totalUTXOs) {
    throw new Error("No UTXOs found.");
  }

  const psbt = new bitcoin.Psbt({ network: networkObj });
  const dummyUtxos = [];

  //find dummy utxos
  for (let i = 0; i < spendableUTXOs.length; i++) {
    const utxo = spendableUTXOs[i];

    if (utxo.sats >= 580 && utxo.sats <= 1000) {
      dummyUtxos.push(utxo);
    }
  }

  if (dummyUtxos.length < 2 || !spendableUTXOs.length) {
    throw new Error("No suitable UTXOs found.");
  }

  let totalInput = 0;

  for (let i = 0; i < 2; i++) {
    const dummyUtxo = dummyUtxos[i];
    const { rawTx } = await OrditApi.fetchTx({ txId: dummyUtxo.txid, network, hex: true })
    if (!rawTx) {
      throw new Error("Failed to get raw transaction for id: " + dummyUtxo.txid);
    }

    if (format !== "p2tr") {
      for (const output in rawTx.outs) {
        try {
          rawTx.setWitness(parseInt(output), []);
        } catch {}
      }
    }
    const input: any = {
      hash: dummyUtxo.txid,
      index: dummyUtxo.n,
      nonWitnessUtxo: rawTx.toBuffer(),
      sequence: 0xfffffffd // Needs to be at least 2 below max int value to be RBF
    };

    const p2shInputRedeemScript: any = {};
    const p2shInputWitnessUTXO: any = {};

    if (format === "p2sh") {
      const p2sh = createTransaction(Buffer.from(publicKey, "hex"), format, network);
      p2shInputWitnessUTXO.witnessUtxo = {
        script: p2sh.output,
        value: dummyUtxo.sats
      };
      p2shInputRedeemScript.redeemScript = p2sh.redeem?.output;
    }

    if (format === "p2tr") {
      const xKey = toXOnly(Buffer.from(publicKey, "hex"));
      const p2tr = createTransaction(xKey, "p2tr", network);

      input.tapInternalKey = toXOnly(Buffer.from(publicKey, "hex"));
      input.witnessUtxo = {
        script: p2tr.output!,
        value: dummyUtxo.sats
      };
    }

    psbt.addInput({
      ...input,
      ...p2shInputWitnessUTXO,
      ...p2shInputRedeemScript
    });
    totalInput += dummyUtxo.sats;
  }

  // Add dummy output
  psbt.addOutput({
    address: address.address!,
    value: dummyUtxos[0].sats + dummyUtxos[1].sats + ordOutNumber
  });

  // Add ordinal output
  psbt.addOutput({
    address: address.address!,
    value: postage
  });

  // seller psbt merge

  const decodedSellerPsbt = bitcoin.Psbt.fromHex(sellerPsbt, { network: networkObj });
  // inputs
  (psbt.data.globalMap.unsignedTx as any).tx.ins[2] = (decodedSellerPsbt.data.globalMap.unsignedTx as any).tx.ins[0];
  psbt.data.inputs[2] = decodedSellerPsbt.data.inputs[0];
  // outputs
  (psbt.data.globalMap.unsignedTx as any).tx.outs[2] = (decodedSellerPsbt.data.globalMap.unsignedTx as any).tx.outs[0];
  psbt.data.outputs[2] = decodedSellerPsbt.data.outputs[0];

  for (let i = 0; i < spendableUTXOs.length; i++) {
    const utxo = spendableUTXOs[i];

    const { rawTx } = await OrditApi.fetchTx({ txId: utxo.txid, network, hex: true })

    if (format !== "p2tr") {
      for (const output in rawTx?.outs) {
        try {
          rawTx.setWitness(parseInt(output), []);
        } catch {}
      }
    }

    const input: any = {
      hash: utxo.txid,
      index: utxo.n,
      nonWitnessUtxo: rawTx?.toBuffer(),
      sequence: 0xfffffffd // Needs to be at least 2 below max int value to be RBF
    };

    if (pubKeyType === "taproot") {
      const xKey = toXOnly(Buffer.from(publicKey, "hex"));
      const p2tr = createTransaction(xKey, "p2tr", network);

      input.tapInternalKey = toXOnly(Buffer.from(publicKey, "hex"));
      input.witnessUtxo = {
        script: p2tr.output!,
        value: utxo.sats
      };
    }

    psbt.addInput({
      ...input
    });

    totalInput += utxo.sats;
  }

  const fee = calculateTxFeeWithRate(psbt.txInputs.length, psbt.txOutputs.length, feeRate);
  const totalOutput = psbt.txOutputs.reduce((partialSum, a) => partialSum + a.value, 0);

  const changeValue = totalInput - totalOutput - fee;
  if (changeValue < 0) {
    throw new Error("Insufficient funds to buy this inscription");
  }

  if (changeValue > 580) {
    psbt.addOutput({
      address: address.address!,
      value: changeValue
    });
  }

  return psbt;
}

export async function generateDummyUtxos({
  value = 600,
  count = 2,
  publicKey,
  feeRate = 10,
  pubKeyType = "taproot",
  network = "testnet"
}: GenerateDummyUtxos) {
  const networkObj = getNetwork(network);
  const format = addressNameToType[pubKeyType];
  const address = getAddressesFromPublicKey(publicKey, network, format)[0];

  const { totalUTXOs, spendableUTXOs } = await OrditApi.fetchUnspentUTXOs({ address: address.address!, network })
  if (!totalUTXOs) {
    throw new Error("No UTXOs found.");
  }

  const psbt = new bitcoin.Psbt({ network: networkObj });
  let totalValue = 0;
  let paymentUtxoCount = 0;

  for (let i = 0; i < spendableUTXOs.length; i++) {
    const utxo = spendableUTXOs[i];
    const { rawTx } = await OrditApi.fetchTx({ txId: utxo.txid, network, hex: true })
    if (!rawTx) {
      throw new Error("Failed to get raw transaction for id: " + utxo.txid);
    }

    const input: any = {
      hash: utxo.txid,
      index: utxo.n,
      nonWitnessUtxo: rawTx.toBuffer(),
      sequence: 0xfffffffd, // Needs to be at least 2 below max int value to be RBF
    };

    if (pubKeyType === "taproot") {
      const xKey = toXOnly(Buffer.from(publicKey, "hex"));
      const p2tr = createTransaction(xKey, "p2tr", network);

      input.tapInternalKey = toXOnly(Buffer.from(publicKey, "hex"));
      input.witnessUtxo = {
        script: p2tr.output!,
        value: utxo.sats
      };
    }

    psbt.addInput(input);

    totalValue += utxo.sats;
    paymentUtxoCount += 1;

    const fees = calculateTxFeeWithRate(
      paymentUtxoCount,
      count, // 2-dummy outputs
      feeRate
    );
    if (totalValue >= value * count + fees) {
      break;
    }
  }

  const finalFees = calculateTxFeeWithRate(
    paymentUtxoCount,
    count, // 2-dummy outputs
    feeRate
  );

  const changeValue = totalValue - value * count - finalFees;
  // We must have enough value to create a dummy utxo and pay for tx fees
  if (changeValue < 0) {
    throw new Error(`You might have pending transactions or not enough fund`);
  }

  Array(count)
    .fill(value)
    .forEach((val) => {
      psbt.addOutput({
        address: address.address!,
        value: val
      });
    });

  if (changeValue > 580) {
    psbt.addOutput({
      address: address.address!,
      value: changeValue
    });
  }

  return psbt;
}

export async function getSellerInputsOutputs({
  inscriptionOutPoint,
  price,
  receiveAddress,
  publicKey,
  pubKeyType = "taproot",
  network = "testnet",
  side = "seller"
}: GenerateSellerInstantBuyPsbtOptions) {
  const format = addressNameToType[pubKeyType];
  const address = getAddressesFromPublicKey(publicKey, network, format)[0];

  const inputs = [];
  const outputs = [];

  const { totalUTXOs, unspendableUTXOs } = await OrditApi.fetchUnspentUTXOs({ address: address.address!, network, type: "all" })
  if (!totalUTXOs) {
    throw new Error("No UTXOs found.");
  }

  let found = false;

  for (let i = 0; i < unspendableUTXOs.length; i++) {
    const unspendableUTXO = unspendableUTXOs[i];
    if (unspendableUTXO.inscriptions!.find((v: any) => v.outpoint == inscriptionOutPoint)) {
      if (unspendableUTXO.inscriptions!.length > 1) {
        throw new Error("Multiple inscriptions! Please split them first.");
      }
      const { rawTx } = await OrditApi.fetchTx({ txId: unspendableUTXO.txid, network, hex: true })
      if (!rawTx) {
        throw new Error("Failed to get raw transaction for id: " + unspendableUTXO.txid);
      }

      if (format !== "p2tr") {
        for (const output in rawTx.outs) {
          try {
            rawTx.setWitness(parseInt(output), []);
          } catch {}
        }
      }

      const options: any = {};

      const data: any = {
        hash: unspendableUTXO.txid,
        index: unspendableUTXO.n,
        nonWitnessUtxo: rawTx.toBuffer(),
        sequence: 0xfffffffd // Needs to be at least 2 below max int value to be RBF
      };
      const postage = unspendableUTXO.sats;

      if (side === "seller") {
        options.sighashType = bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY;
      }

      if (format === "p2tr") {
        const xKey = toXOnly(Buffer.from(publicKey, "hex"));
        const p2tr = createTransaction(xKey, "p2tr", network);

        data.tapInternalKey = toXOnly(Buffer.from(publicKey, "hex"));
        data.witnessUtxo = {
          script: p2tr.output!,
          value: postage
        };
      }

      inputs.push({
        ...data,
        ...options
      });
      outputs.push({ address: receiveAddress, value: price + postage });

      found = true;
      break;
    }
  }

  if (!found) {
    throw new Error("inscription not found.");
  }

  return { inputs, outputs };
}

export interface UnspentOutput {
  txId: string;
  outputIndex: number;
  satoshis: number;
  scriptPk: string;
  addressType: AddressTypes;
  address: string;
  ords: {
    id: string;
    offset: number;
  }[];
}

export interface GenerateSellerInstantBuyPsbtOptions {
  inscriptionOutPoint: string;
  price: number;
  receiveAddress: string;
  publicKey: string;
  pubKeyType?: AddressFormats;
  network?: Network;
  side?: "seller" | "buyer";
}

export interface GenerateBuyerInstantBuyPsbtOptions {
  publicKey: string;
  pubKeyType?: AddressFormats;
  network?: Network;
  feeRate?: number;
  inscriptionOutPoint: string;
  sellerPsbt: string;
}

export interface GenerateDummyUtxos {
  value: number;
  count: number;
  publicKey: string;
  pubKeyType?: AddressFormats;
  network?: Network;
  feeRate?: number;
}
