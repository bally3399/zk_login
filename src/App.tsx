import React, { useEffect, useRef, useState } from 'react';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'; //Retrieves the URL for a Sui network (e.g., testnet).
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'; //Generates and manages Ed25519 keypairs for cryptographic operations.
import { Transaction } from '@mysten/sui/transactions'; //Represents a Sui transaction for signing and execution.
import {
  genAddressSeed,
  generateNonce,
  generateRandomness,
  getExtendedEphemeralPublicKey,
  getZkLoginSignature,
  jwtToAddress,
} from '@mysten/sui/zklogin'; //Utilities for zkLogin, handling address generation, nonce creation, randomness, and signature generation.
import { jwtDecode } from 'jwt-decode'; //Decodes JSON Web Tokens (JWTs) to extract claims like sub (subject) and aud (audience).
import { Modal, isLocalhost } from '@polymedia/suitcase-react';
import config from './config.example.json';
import { AccountPanel } from './components/AccountPanel';
import './App.less';


export const NETWORK = 'testnet';
const MAX_EPOCH = 2;
const SUI_CLIENT = new SuiClient({ url: getFullnodeUrl(NETWORK) });
const SETUP_KEY = 'zklogin-demo.setup';
const ACCOUNTS_KEY = 'zklogin-demo.accounts';

type OpenIdProvider = 'Google';
type SetupData = { provider: OpenIdProvider; maxEpoch: number; randomness: string; privateKey: string };
type AccountData = { provider: OpenIdProvider; address: string; zkProofs: any; privateKey: string; salt: string; sub: string; aud: string; maxEpoch: number };

export const App: React.FC = () => {
  const accountsRef = useRef<AccountData[]>(loadAccounts());
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [modal, setModal] = useState<string>('');

  // Runs on component on mount to handle OAuth redirects, fetch balances.
  useEffect(() => {
    handleRedirect();
    // @ts-ignore
    const id = setInterval(5000);
    return () => clearInterval(id);
  }, []);

  // Saves setup data (provider, epoch, randomness, private key) to sessionStorage.
  const saveSetup = (data: SetupData) => sessionStorage.setItem(SETUP_KEY, JSON.stringify(data));
  // Loads setup data from sessionStorage, returning null if not found.
  const loadSetup = (): SetupData | null => JSON.parse(sessionStorage.getItem(SETUP_KEY) || 'null');
  // Removes setup data from sessionStorage.
  const clearSetup = () => sessionStorage.removeItem(SETUP_KEY);


  // Saves a new account to accountsRef and sessionStorage, then refreshes balances.
  const saveAccount = (acct: AccountData) => {
    if (!acct.address.startsWith('0x')) return;
    accountsRef.current = [acct, ...accountsRef.current];
    sessionStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accountsRef.current));
  };

  // Loads accounts from sessionStorage, filtering valid addresses, or returns an empty array on error.
  function loadAccounts(): AccountData[] {
    try {
      const raw = JSON.parse(sessionStorage.getItem(ACCOUNTS_KEY) || '[]');
      return raw.filter((a: any) => typeof a.address === 'string' && a.address.startsWith('0x'));
    } catch {
      return [];
    }
  }

  // Clears all sessionStorage, resets accountsRef.
  const clearState = () => {
    sessionStorage.clear();
    accountsRef.current = [];
  };


  // Initiates OAuth login flow with the specified provider, generating keys and redirecting to the provider's auth URL.
  const startLogin = async (provider: OpenIdProvider) => {
    setModal(`Logging in with ${provider}…`);
    const { epoch } = await SUI_CLIENT.getLatestSuiSystemState();
    const maxEpoch = Number(epoch) + MAX_EPOCH;
    const keypair = new Ed25519Keypair();
    const randomness = generateRandomness();
    const nonce = generateNonce(keypair.getPublicKey(), maxEpoch, randomness);
    saveSetup({ provider, maxEpoch, randomness: randomness.toString(), privateKey: keypair.getSecretKey()});

    const CLIENT_ID_MAP: Record<OpenIdProvider, keyof typeof config> = {
      Google: 'CLIENT_ID_GOOGLE'
    };
    const params = new URLSearchParams({
      client_id: config[CLIENT_ID_MAP[provider]],
      nonce,
      redirect_uri: window.location.origin + '/callback',
      response_type: 'id_token',
      scope: 'openid',
    });
    const urlMap: Record<OpenIdProvider, string> = {
      Google: 'accounts.google.com/o/oauth2/v2/auth'
    };
    window.location.href = `https://${urlMap[provider]}?${params}`;
  };

  const handleRedirect = async () => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const jwt = new URLSearchParams(hash).get('id_token');
    window.history.replaceState(null, '', window.location.pathname + '/callback');

    if (!jwt) return;

    const { sub, aud } = jwtDecode<{ sub: string; aud: string }>(jwt);
    const setup = loadSetup(); if (!setup) return;
    clearSetup();

    const saltRes = await fetch(config.URL_SALT_SERVICE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt }),
    });
    const { salt } = await saltRes.json();
    let rawAddress = jwtToAddress(jwt, BigInt(salt));
    const address = rawAddress.startsWith('0x') ? rawAddress : `0x${rawAddress}`;

    const payload = {
      maxEpoch: setup.maxEpoch,
      jwtRandomness: setup.randomness,
      extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(new Ed25519Keypair().getPublicKey()),
      jwt,
      salt,
      keyClaimName: 'sub',
    };
    
    const zkRes = await fetch(config.URL_ZK_PROVER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const zkProofs = await zkRes.json();

    saveAccount({ provider: setup.provider, address, zkProofs, privateKey: setup.privateKey, salt, sub, aud, maxEpoch: setup.maxEpoch });
    setModal('');
  };


  // Signs and executes a transaction using zkLogin credentials, updating the modal with the result.
  const signTx = async (acct: AccountData, txBytes: string) => {
    setModal('Signing transaction…');
    try {
      const keypair = Ed25519Keypair.fromSecretKey(acct.privateKey);
      const tx = Transaction.from(Buffer.from(txBytes, 'base64'));
      tx.setSender(acct.address);
      const { bytes, signature } = await tx.sign({ client: SUI_CLIENT, signer: keypair });
      const seed = genAddressSeed(BigInt(acct.salt), 'sub', acct.sub, acct.aud).toString();
      const zkSig = getZkLoginSignature({ inputs: { ...acct.zkProofs, addressSeed: seed }, maxEpoch: acct.maxEpoch, userSignature: signature });
      const result = await SUI_CLIENT.executeTransactionBlock({
        transactionBlock: bytes,
        signature: zkSig,
        options: { showEffects: true, showObjectChanges: true },
      });
      setModal(`Transaction succeeded: ${result.digest}`);
    } catch (err) {
      console.error('Transaction failed', err);
      setModal(`Transaction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const providers: OpenIdProvider[] = isLocalhost() ? ['Google'] : ['Google'];


  return (
    <div id="page">
      <Modal onClose={() => setModal('')} >{modal}</Modal>
      <div id="network-indicator">{NETWORK}</div>
      <h1>zkLogin practice</h1>
      <section id="login-buttons" className="section">
        <h2>Log in with:</h2>
        {providers.map(p => (
          <button key={p} className={`btn-login ${p}`} onClick={() => startLogin(p)}>
            {p}
          </button>
        ))}
      </section>
      <section id="accounts" className="section">
        {accountsRef.current
          .filter(acct => acct.address)
          .map((acct, idx) => (
            <div key={`${acct.address}-${idx}`}>
              <AccountPanel
                account={acct}
                balance={balances.get(acct.address)}
                signTx={txBytes => signTx(acct, txBytes)}
              />
            </div>
          ))}
        <button className="btn-clear" onClick={clearState}>🧨 CLEAR STATE</button>
      </section>
    </div>
  );
};