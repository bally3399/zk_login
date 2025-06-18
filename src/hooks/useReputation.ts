import { useState, useEffect } from 'react';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const SUI_CLIENT = new SuiClient({ url: getFullnodeUrl('devnet') });
const BACKEND_URL = 'http://localhost:3001';

export const useReputation = (address: string | null) => {
  const [reputation, setReputation] = useState<number | null>(null);
  const [reputationId, setReputationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReputation = async () => {
    if (!address) return;
    setLoading(true);
    try {
      console.log(`Fetching reputation for address: ${address}`);
      const response = await fetch(`${BACKEND_URL}/get-reputation?userAddress=${address}`);
      const data = await response.json();
      if (data.success) {
        setReputation(Number(data.score));
        const reps = await SUI_CLIENT.getOwnedObjects({
          owner: address,
          filter: { StructType: `${data.PACKAGE_ID}::microloan::Reputation` },
          options: { showContent: true },
        });
        if (reps.data.length && reps.data[0].data && 'objectId' in reps.data[0].data) {
          setReputationId(reps.data[0].data.objectId);
        }
      } else {
        setReputation(null);
        setReputationId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const initReputation = async (signTx: (txBytes: string) => Promise<void>) => {
    setLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/init-reputation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: address }),
      });
      const { success, transactionBytes, error } = await response.json();
      if (!success) throw new Error(error);
      await signTx(transactionBytes);
      await fetchReputation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReputation();
  }, [address]);

  return { reputation, reputationId, loading, error, initReputation, refetch: fetchReputation };
};