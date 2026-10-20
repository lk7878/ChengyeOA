import { useEffect, useState } from 'react';
import type { FormInstance } from 'antd';
import dayjs from 'dayjs';
import { contractApi } from '@/api/contract';
import { customerApi } from '@/api/customer';

/** Ignore late responses after changing/clearing the selected contract. Clearing retains manual values. */
export function useContractIntake(
  form: FormInstance,
  contractId: string | undefined,
  syncIdentity: boolean,
  open: boolean,
) {
  const [result, setResult] = useState<{ id?: string; error?: string }>();
  useEffect(() => {
    let active = true;
    if (open && contractId) {
      setResult(undefined);
      void contractApi
        .detail(contractId)
        .then(async (response) => {
          const contract = response.data;
          const customer = (await customerApi.detail(contract.customerId)).data;
          if (!active) return;
          form.setFieldsValue({
            ...(syncIdentity ? { customerId: contract.customerId, fee: contract.amount } : {}),
            intakeData: {
              ...form.getFieldValue('intakeData'),
              ...(syncIdentity ? { contractNumber: contract.contractNo } : {}),
              signedDate: contract.signDate ? dayjs(contract.signDate) : null,
              region: customer.address ?? '',
              customerPhone: customer.phone ?? '',
            },
          });
          setResult({ id: contractId });
        })
        .catch(() => {
          if (active) setResult({ id: contractId, error: '合同或客户资料加载失败，请重新选择合同后重试。' });
        });
    }
    return () => {
      active = false;
    };
  }, [form, contractId, syncIdentity, open]);
  return {
    loading: !!(open && contractId && result?.id !== contractId),
    error: open && contractId && result?.id === contractId ? result.error : undefined,
  };
}
