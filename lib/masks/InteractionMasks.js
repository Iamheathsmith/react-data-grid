import React, { useState, useRef, useEffect, useCallback } from 'react';
// Components
import CellMask from './CellMask';
import DragMask from './DragMask';
import EditorContainer from '../editors/EditorContainer';
import EditorPortal from '../editors/EditorPortal';
import { legacyCellInput } from '../editors/CellInputHandlers';
// Utils
import { isCtrlKeyHeldDown, getSelectedDimensions as getDimensions, getNextSelectedCellPosition, canExitGrid, isSelectedCellEditable } from '../utils';
import { UpdateActions, CellNavigationMode } from '../common/enums';
export default function InteractionMasks({ columns, rows, rowHeight, eventBus, enableCellAutoFocus, enableCellCopyPaste, enableCellDragAndDrop, editorPortalTarget, cellNavigationMode, gridRef, totalHeaderHeight, scrollLeft, scrollTop, onSelectedCellChange, onCheckCellIsEditable, onRowsUpdate, scrollToCell }) {
    const [selectedPosition, setSelectedPosition] = useState(() => {
        if (enableCellAutoFocus && document.activeElement === document.body && columns.length > 0 && rows.length > 0) {
            return { idx: 0, rowIdx: 0, status: 'SELECT' };
        }
        return { idx: -1, rowIdx: -1, status: 'SELECT' };
    });
    const [copiedPosition, setCopiedPosition] = useState(null);
    const [draggedPosition, setDraggedPosition] = useState(null);
    const selectionMaskRef = useRef(null);
    // Focus on the selection mask when the selected position is changed or the editor is closed
    useEffect(() => {
        var _a;
        if (selectedPosition.rowIdx === -1 || selectedPosition.idx === -1 || selectedPosition.status === 'EDIT')
            return;
        (_a = selectionMaskRef.current) === null || _a === void 0 ? void 0 : _a.focus();
    }, [selectedPosition]);
    useEffect(() => {
        return eventBus.subscribe('SELECT_CELL', selectCell);
    });
    useEffect(() => {
        if (draggedPosition === null)
            return;
        const handleDragEnter = (overRowIdx) => {
            setDraggedPosition({ ...draggedPosition, overRowIdx });
        };
        return eventBus.subscribe('DRAG_ENTER', handleDragEnter);
    }, [draggedPosition, eventBus]);
    const closeEditor = useCallback(() => {
        setSelectedPosition(({ idx, rowIdx }) => ({ idx, rowIdx, status: 'SELECT' }));
    }, []);
    // Reset the positions if the current values are no longer valid. This can happen if a column or row is removed
    if (selectedPosition.idx > columns.length || selectedPosition.rowIdx > rows.length) {
        setSelectedPosition({ idx: -1, rowIdx: -1, status: 'SELECT' });
        setCopiedPosition(null);
        setDraggedPosition(null);
    }
    function getEditorPosition() {
        if (gridRef.current === null)
            return { left: 0, top: 0 };
        const { left, top } = gridRef.current.getBoundingClientRect();
        const { scrollTop: docTop, scrollLeft: docLeft } = document.scrollingElement || document.documentElement;
        const gridLeft = left + docLeft;
        const gridTop = top + docTop;
        const column = columns[selectedPosition.idx];
        return {
            left: gridLeft + column.left - (column.frozen ? 0 : scrollLeft),
            top: gridTop + totalHeaderHeight + selectedPosition.rowIdx * rowHeight - scrollTop
        };
    }
    function getNextPosition(key, mode = cellNavigationMode, shiftKey = false) {
        const { idx, rowIdx } = selectedPosition;
        let nextPosition;
        switch (key) {
            case 'ArrowUp':
                nextPosition = { idx, rowIdx: rowIdx - 1 };
                break;
            case 'ArrowDown':
                nextPosition = { idx, rowIdx: rowIdx + 1 };
                break;
            case 'ArrowLeft':
                nextPosition = { idx: idx - 1, rowIdx };
                break;
            case 'ArrowRight':
                nextPosition = { idx: idx + 1, rowIdx };
                break;
            case 'Tab':
                nextPosition = { idx: idx + (shiftKey ? -1 : 1), rowIdx };
                break;
            default:
                nextPosition = { idx, rowIdx };
                break;
        }
        return getNextSelectedCellPosition({
            columns,
            rowsCount: rows.length,
            cellNavigationMode: mode,
            nextPosition
        });
    }
    function onKeyDown(event) {
        var _a;
        const column = columns[selectedPosition.idx];
        const row = rows[selectedPosition.rowIdx];
        const isActivatedByUser = ((_a = column.unsafe_onCellInput) !== null && _a !== void 0 ? _a : legacyCellInput)(event, row) === true;
        const { key } = event;
        if (enableCellCopyPaste && isCtrlKeyHeldDown(event)) {
            // event.key may be uppercase `C` or `V`
            const lowerCaseKey = event.key.toLowerCase();
            if (lowerCaseKey === 'c')
                return handleCopy();
            if (lowerCaseKey === 'v')
                return handlePaste();
        }
        const canOpenEditor = selectedPosition.status === 'SELECT' && isCellEditable(selectedPosition);
        switch (key) {
            case 'Enter':
                if (canOpenEditor) {
                    setSelectedPosition(({ idx, rowIdx }) => ({ idx, rowIdx, status: 'EDIT', key: 'Enter' }));
                }
                else if (selectedPosition.status === 'EDIT') {
                    setSelectedPosition(({ idx, rowIdx }) => ({ idx, rowIdx, status: 'SELECT' }));
                }
                break;
            case 'Escape':
                closeEditor();
                setCopiedPosition(null);
                break;
            case 'Tab':
                onPressTab(event);
                break;
            case 'ArrowUp':
            case 'ArrowDown':
            case 'ArrowLeft':
            case 'ArrowRight':
                event.preventDefault();
                selectCell(getNextPosition(key));
                break;
            default:
                if (canOpenEditor && isActivatedByUser) {
                    setSelectedPosition(({ idx, rowIdx }) => ({ idx, rowIdx, status: 'EDIT', key }));
                }
                break;
        }
    }
    function onPressTab(e) {
        // If we are in a position to leave the grid, stop editing but stay in that cell
        if (canExitGrid(e, { cellNavigationMode, columns, rowsCount: rows.length, selectedPosition })) {
            if (selectedPosition.status === 'EDIT') {
                closeEditor();
                return;
            }
            // Reset the selected position before exiting
            setSelectedPosition({ idx: -1, rowIdx: -1, status: 'SELECT' });
            return;
        }
        e.preventDefault();
        const tabCellNavigationMode = cellNavigationMode === CellNavigationMode.NONE
            ? CellNavigationMode.CHANGE_ROW
            : cellNavigationMode;
        const nextPosition = getNextPosition('Tab', tabCellNavigationMode, e.shiftKey);
        selectCell(nextPosition);
    }
    function handleCopy() {
        const { idx, rowIdx } = selectedPosition;
        const value = rows[rowIdx][columns[idx].key];
        navigator.clipboard.writeText(String(value))
            .catch(error => { console.error('Failed to copy to clipboard', { error }); });
        setCopiedPosition({ idx, rowIdx, value });
    }
    function handlePaste() {
        if (copiedPosition === null || !isCellEditable(selectedPosition)) {
            return;
        }
        const { rowIdx: toRow } = selectedPosition;
        const cellKey = columns[selectedPosition.idx].key;
        const { rowIdx: fromRow, idx, value } = copiedPosition;
        const fromCellKey = columns[idx].key;
        onRowsUpdate({
            cellKey,
            fromRow,
            toRow,
            updated: { [cellKey]: value },
            action: UpdateActions.COPY_PASTE,
            fromCellKey
        });
    }
    function isCellWithinBounds({ idx, rowIdx }) {
        return rowIdx >= 0 && rowIdx < rows.length && idx >= 0 && idx < columns.length;
    }
    function isCellEditable(position) {
        return isCellWithinBounds(position)
            && isSelectedCellEditable({ columns, rows, selectedPosition: position, onCheckCellIsEditable });
    }
    function selectCell(position, enableEditor = false) {
        if (!isCellWithinBounds(position))
            return;
        if (enableEditor && isCellEditable(position)) {
            setSelectedPosition({ ...position, status: 'EDIT', key: null });
        }
        else {
            setSelectedPosition({ ...position, status: 'SELECT' });
        }
        scrollToCell(position);
        onSelectedCellChange === null || onSelectedCellChange === void 0 ? void 0 : onSelectedCellChange({ ...position });
    }
    function isDragEnabled() {
        return enableCellDragAndDrop && isCellEditable(selectedPosition);
    }
    function handleDragStart(e) {
        e.dataTransfer.effectAllowed = 'copy';
        // Setting data is required to make an element draggable in FF
        const transferData = JSON.stringify(selectedPosition);
        try {
            e.dataTransfer.setData('text/plain', transferData);
        }
        catch (ex) {
            // IE only supports 'text' and 'URL' for the 'type' argument
            e.dataTransfer.setData('text', transferData);
        }
        setDraggedPosition({ ...selectedPosition, overRowIdx: selectedPosition.rowIdx });
    }
    function handleDragEnd() {
        if (draggedPosition === null)
            return;
        const { rowIdx, overRowIdx } = draggedPosition;
        const column = columns[draggedPosition.idx];
        const cellKey = column.key;
        const value = rows[rowIdx][cellKey];
        onRowsUpdate({
            cellKey,
            fromRow: rowIdx,
            toRow: overRowIdx,
            updated: { [cellKey]: value },
            action: UpdateActions.CELL_DRAG
        });
        setDraggedPosition(null);
    }
    function onDragHandleDoubleClick() {
        const column = columns[selectedPosition.idx];
        const cellKey = column.key;
        const value = rows[selectedPosition.rowIdx][cellKey];
        onRowsUpdate({
            cellKey,
            fromRow: selectedPosition.rowIdx,
            toRow: rows.length - 1,
            updated: { [cellKey]: value },
            action: UpdateActions.COLUMN_FILL
        });
    }
    function onCommit({ cellKey, rowIdx, updated }) {
        onRowsUpdate({
            cellKey,
            fromRow: rowIdx,
            toRow: rowIdx,
            updated,
            action: UpdateActions.CELL_UPDATE
        });
        closeEditor();
    }
    function getSelectedDimensions(selectedPosition) {
        return getDimensions({ selectedPosition, columns, scrollLeft, rowHeight });
    }
    return (React.createElement("div", { onKeyDown: onKeyDown },
        copiedPosition && isCellWithinBounds(copiedPosition) && (React.createElement(CellMask, Object.assign({ className: "rdg-cell-copied" }, getSelectedDimensions(copiedPosition)))),
        draggedPosition && isCellWithinBounds(draggedPosition) && (React.createElement(DragMask, { draggedPosition: draggedPosition, getSelectedDimensions: getSelectedDimensions })),
        selectedPosition.status === 'SELECT' && isCellWithinBounds(selectedPosition) && (React.createElement(CellMask, Object.assign({ className: "rdg-selected", tabIndex: 0, ref: selectionMaskRef }, getSelectedDimensions(selectedPosition)), isDragEnabled() && (React.createElement("div", { className: "drag-handle", draggable: true, onDragStart: handleDragStart, onDragEnd: handleDragEnd, onDoubleClick: onDragHandleDoubleClick })))),
        selectedPosition.status === 'EDIT' && isCellWithinBounds(selectedPosition) && (React.createElement(EditorPortal, { target: editorPortalTarget },
            React.createElement(EditorContainer, Object.assign({ firstEditorKeyPress: selectedPosition.key, onCommit: onCommit, onCommitCancel: closeEditor, rowIdx: selectedPosition.rowIdx, row: rows[selectedPosition.rowIdx], rowHeight: rowHeight, column: columns[selectedPosition.idx], scrollLeft: scrollLeft, scrollTop: scrollTop }, getEditorPosition()))))));
}
//# sourceMappingURL=InteractionMasks.js.map