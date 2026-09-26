import React, { useState } from 'react';

export default function ItemModal({ item, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(item?.title || '');
  const [description, setDescription] = useState(item?.description || '');
  const [link, setLink] = useState(item?.link || '');
  const [price, setPrice] = useState(item?.price ?? '');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setError('Namn krävs'); return; }
    try {
      await onSave({ title: title.trim(), description: description.trim(), link: link.trim(), price });
    } catch (err) {
      setError(err.message || 'Något gick fel');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="day-detail-header">
          <h2>{item ? 'Redigera önskning' : 'Ny önskning'}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <form className="modal-form" onSubmit={submit}>
          <div>
            <label>Namn</label>
            <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="T.ex. Lego Technic" />
          </div>

          <div>
            <label>Beskrivning <span className="field-hint">(valfritt)</span></label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Storlek, färg, varför du önskar dig den..." />
          </div>

          <div>
            <label>Länk till exempel <span className="field-hint">(valfritt)</span></label>
            <input type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://..." />
          </div>

          <div>
            <label>Ungefärligt pris (kr) <span className="field-hint">(valfritt)</span></label>
            <input type="number" min="0" step="1" value={price} onChange={e => setPrice(e.target.value)} placeholder="299" />
          </div>

          {error && <span className="field-error">{error}</span>}

          <div className="modal-actions">
            <button type="submit" className="btn">Spara</button>
            {onDelete && (
              <button type="button" className="btn btn-danger" onClick={onDelete}>Ta bort</button>
            )}
            <button type="button" className="btn btn-ghost btn-ml" onClick={onClose}>Avbryt</button>
          </div>
        </form>
      </div>
    </div>
  );
}
