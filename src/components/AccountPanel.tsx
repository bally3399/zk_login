import React from 'react';
import { makePolymediaUrl } from '@polymedia/suitcase-core';
import { useReputation } from '../hooks/useReputation';
import { NETWORK } from '../App';

type AccountPanelProps = {
  account: { address: string; provider: string; sub: string };
  balance: number | undefined;
  signTx: (txBytes: string) => Promise<void>;
};

export const AccountPanel: React.FC<AccountPanelProps> = ({ account, balance, signTx }) => {
  const {} = useReputation(account.address);

  return (
    <div className="account">
      <label className={`provider ${account.provider}`}>{account.provider}</label>
      <div>
        Address: <a href={makePolymediaUrl(NETWORK, 'address', account.address)} target="_blank" rel="noopener">{account.address}</a>
      </div>
      <div>User ID: {account.sub}</div>

      <hr />
    </div>
  );
};