import { redirect } from 'next/navigation';
import { ADMINISTRATION_DEFAULT_ROUTE } from '@/features/administration/layout/administration-sidebar-types';

export default function AdministrationPage() {
  redirect(ADMINISTRATION_DEFAULT_ROUTE);
}
