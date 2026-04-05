'use client';

import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import type { MarketRow } from '@/lib/markets-api';

export interface DeletePairModalProps {
  open: boolean;
  market: MarketRow | null;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function DeletePairModal({ open, market, onClose, onConfirm, isLoading }: DeletePairModalProps) {
  const symbol =
    market?.base_asset && market?.quote_asset
      ? `${market.base_asset}/${market.quote_asset}`
      : (market?.symbol ?? '').replace(/_/g, '/');

  return (
    <Modal open={open} onClose={onClose} title="Delete Trading Pair" size="sm">
      <p className="text-sm text-admin-muted">
        Are you sure you want to permanently delete <span className="font-semibold text-admin-text">{symbol || 'this pair'}</span>?
        This action cannot be undone.
      </p>
      <ModalFooter className="-mx-6 -mb-5 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} disabled={isLoading} loading={isLoading}>
          Delete
        </Button>
      </ModalFooter>
    </Modal>
  );
}
