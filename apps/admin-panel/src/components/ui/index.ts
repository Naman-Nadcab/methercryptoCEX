/**
 * Design System — barrel export.
 *
 * Usage:
 *   import { Button, Card, Badge, Modal, DataTable, Tabs, Input } from '@/components/ui';
 */

export { Button, type ButtonProps } from './Button';
export { Card, CardHeader, CardTitle, CardContent, CardFooter, type CardProps } from './Card';
export { Badge, type BadgeProps, type BadgeVariant } from './Badge';
export { Input, Textarea, type InputProps, type TextareaProps } from './Input';
export { Modal, ModalFooter, type ModalProps } from './Modal';
export { Tabs, type TabsProps, type TabItem } from './Tabs';
export { DataTable, type DataTableProps, type DataTablePagination } from './DataTable';
export { DropdownMenu, Select, type DropdownItem, type DropdownMenuProps, type SelectOption, type SelectProps } from './Dropdown';
export { SafeActionModal, type SafeActionConfig, type SafeActionSeverity } from './SafeActionModal';
export { Skeleton, TableSkeleton, KpiSkeleton, FormSkeleton, DetailSkeleton } from './Skeleton';
