import { createRoot } from 'react-dom/client';
import { subscribeModalEvents } from '../../js/ui/modals.js';
import { ModalHost } from './ModalHost.jsx';

export function mountModalHost(element) {
    if (!element) {
        throw new Error('mountModalHost: target element is required');
    }


    const root = createRoot(element);
    let modals = [];
    let progresses = [];

    const render = () => {
        root.render(
            <ModalHost
                modals={modals}
                progresses={progresses}
            />
        );
    };

    const unsubscribe = subscribeModalEvents((event) => {
        if (event?.type === 'showModal' && event.modal) {
            modals = [...modals, event.modal];
            render();
            return;
        }
        if (event?.type === 'removeModal') {
            modals = modals.filter((m) => m.id !== event.id);
            render();
            return;
        }
        if (event?.type === 'showProgress' && event.progress) {
            progresses = [...progresses, event.progress];
            render();
            return;
        }
        if (event?.type === 'updateProgress') {
            progresses = progresses.map((p) => (
                p.id === event.id
                    ? {
                        ...p,
                        percent: event.percent,
                        step: event.step,
                        fileName: event.fileName ?? p.fileName,
                        fileSize: event.fileSize ?? p.fileSize,
                        fileIndex: event.fileIndex ?? p.fileIndex,
                        fileCount: event.fileCount ?? p.fileCount,
                        batchLabelUnit: event.batchLabelUnit ?? p.batchLabelUnit
                    }
                    : p
            ));
            render();
            return;
        }
        if (event?.type === 'removeProgress') {
            progresses = progresses.filter((p) => p.id !== event.id);
            render();
        }
    });

    render();

    return {
        unmount: () => {
            unsubscribe();
            root.unmount();
        }
    };
}
