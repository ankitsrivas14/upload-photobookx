import { lazy, Suspense, useEffect } from 'react';
import { useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { PageHeader, Skeleton } from '../components/ui/pbx';
import { findSection } from '../layouts/adminNav';
import styles from './AnalysisPage.module.css';

// Each tab loads the first time it is opened (Agency pulls in recharts).
const FailedOrdersAnalysis = lazy(() => import('./analysis/FailedOrdersAnalysis').then((m) => ({ default: m.FailedOrdersAnalysis })));
const FailureReasons = lazy(() => import('./analysis/FailureReasons').then((m) => ({ default: m.FailureReasons })));
const FailureReasonsMonth = lazy(() => import('./analysis/FailureReasonsMonth').then((m) => ({ default: m.FailureReasonsMonth })));
const PinCodesAnalysis = lazy(() => import('./analysis/PinCodesAnalysis').then((m) => ({ default: m.PinCodesAnalysis })));
const StuckOrdersAnalysis = lazy(() => import('./analysis/StuckOrdersAnalysis').then((m) => ({ default: m.StuckOrdersAnalysis })));
const TicketsAnalysis = lazy(() => import('./analysis/TicketsAnalysis').then((m) => ({ default: m.TicketsAnalysis })));
const CreateTicketForm = lazy(() => import('./analysis/CreateTicketForm').then((m) => ({ default: m.CreateTicketForm })));
const ClaudeAnalysis = lazy(() => import('./analysis/ClaudeAnalysis').then((m) => ({ default: m.ClaudeAnalysis })));
const Reels = lazy(() => import('./analysis/Reels').then((m) => ({ default: m.Reels })));
const Agency = lazy(() => import('./analysis/Agency').then((m) => ({ default: m.Agency })));

// The admin shell loads the signed-in user, draws the topbar and lists the sections in the sidebar.
export function AnalysisPage() {
    const navigate = useNavigate();
    const location = useLocation();

    const currentPath = location.pathname;
    const { page } = findSection(currentPath);

    useEffect(() => {
        if (currentPath === '/admin/analysis' || currentPath === '/admin/analysis/') {
            navigate('/admin/analysis/failed-orders', { replace: true });
        }
    }, [currentPath, navigate]);

    return (
        <div className={styles.page}>
            <PageHeader eyebrow="Analysis" title={page?.label ?? 'Analysis'} />

            <Suspense fallback={<Skeleton lines={6} />}>
                <Routes>
                    {/* The CSV-based Ads Analysis was retired; Claude Analysis replaced it. */}
                    <Route path="ads" element={<Navigate to="/admin/analysis/claude" replace />} />
                    <Route path="claude" element={<ClaudeAnalysis />} />
                    <Route path="failed-orders" element={<FailedOrdersAnalysis />} />
                    <Route path="failure-reasons" element={<FailureReasons />} />
                    <Route path="failure-reasons/:month" element={<FailureReasonsMonth />} />
                    <Route path="pin-codes" element={<PinCodesAnalysis />} />
                    <Route path="stuck-orders" element={<StuckOrdersAnalysis />} />
                    <Route path="tickets" element={<TicketsAnalysis />} />
                    <Route path="tickets/new" element={<CreateTicketForm />} />
                    <Route path="reels" element={<Reels />} />
                    <Route path="agency" element={<Agency />} />
                    <Route path="*" element={<Navigate to="claude" replace />} />
                </Routes>
            </Suspense>
        </div>
    );
}
