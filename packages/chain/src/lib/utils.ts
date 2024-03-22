import { Field, PublicKey, Signature, UInt64 } from "o1js";
import { PendingTransaction, UnsignedTransaction } from "@proto-kit/sequencer";

export interface NonceQueryResponse {
  data: {
    protocol: {
      AccountState: {
        accountState: {
          nonce: number;
        };
      };
    };
  };
}

export const getNonce = async (key: string) => {
  const response = await fetch(
    process.env.NEXT_PUBLIC_PROTOKIT_URL || "http://localhost:8080/graphql",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
        query GetNonce {
          protocol {
            AccountState {
              accountState(key: "${key}") {
                nonce
              }
            }
          }
        }
        `,
      }),
    },
  );
  const { data } = (await response.json()) as NonceQueryResponse;
  return data.protocol.AccountState.accountState?.nonce || 0;
};

// Note: duplicated from apps/web/lib/stores/chain.tsx
export interface ComputedTransactionJSON {
  argsFields: string[];
  argsJSON: string[];
  methodId: string;
  nonce: string;
  sender: string;
  signature: {
    r: string;
    s: string;
  };
}

export interface ComputedBlockJSON {
  txs?: {
    status: boolean;
    statusMessage?: string;
    tx: ComputedTransactionJSON;
  }[];
}

export interface BlockQueryResponse {
  data: {
    network: {
      unproven?: {
        block: {
          height: string;
        };
      };
    };
    block: ComputedBlockJSON;
  };
}

export const getBlock = async () => {
  const response = await fetch(
    process.env.NEXT_PUBLIC_PROTOKIT_URL || "http://localhost:8080/graphql",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
            query GetBlock {
              block {
                txs {
                  tx {
                    argsFields
                    argsJSON
                    methodId
                    nonce
                    sender
                    signature {
                      r
                      s
                    }
                  }
                  status
                  statusMessage
                }
              }
              network {
                unproven {
                  block {
                    height
                  }
                }
              }
            }
          `,
      }),
    },
  );

  const { data } = (await response.json()) as BlockQueryResponse;
  return data;
};

export type TXStatus = {
  status: "PENDING" | "SUCCESS" | "FAILURE";
  statusMessage?: string;
};

// txn success or failure
export async function getTxnStatus(
  txSeek: PendingTransaction | UnsignedTransaction,
  fnWaiting: () => void = () => {},
  interval: number = 1000,
  maxRetries: number = 10,
): Promise<TXStatus> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const chain = await getBlock();

      const confirmedTransactions = chain.block?.txs?.map(
        ({ tx, status, statusMessage }) => {
          return {
            tx: new PendingTransaction({
              isMessage: false,
              methodId: Field(tx.methodId),
              nonce: UInt64.from(tx.nonce),
              sender: PublicKey.fromBase58(tx.sender),
              argsFields: tx.argsFields.map((arg) => Field(arg)),
              argsJSON: tx.argsJSON,
              signature: Signature.fromJSON({
                r: tx.signature.r,
                s: tx.signature.s,
              }),
            }),
            status,
            statusMessage,
          };
        },
      );

      const foundTransaction = confirmedTransactions?.find(
        ({ tx }) => txSeek.hash().toString() === tx.hash().toString(),
      );
      if (foundTransaction) {
        const { status, statusMessage } = foundTransaction;
        return { status: status ? "SUCCESS" : "FAILURE", statusMessage };
      }
    } catch (e: any) {
      console.error("getTxnStatus error", e.message);
    }

    if (fnWaiting) fnWaiting();

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return { status: "PENDING" };
}
