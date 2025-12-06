// =======================
// Configuración de API
// =======================
const API_BASE = 'http://192.168.176.114:3333/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, ''); // http://192.168.176.112:3333

// Imagen local de respaldo
const FALLBACK_IMG = 'logos/logos.png';

// =======================
// Helpers
// =======================
const pad2 = (n) => String(n).padStart(2, '0');

const buildImageUrl = (raw) => {
  if (!raw) return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.startsWith('/')) return API_ORIGIN + raw;
  return API_ORIGIN + '/' + raw.replace(/^\/+/, '');
};

const dateKeyFromISO = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${y}-${m}-${dd}`;
};

const formatRange = (start, end) => {
  if (!start && !end) return '';
  const ds = start ? new Date(start) : null;
  const de = end ? new Date(end) : null;

  if (ds && de) {
    const sameDay = ds.toDateString() === de.toDateString();
    const optsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const optsTime = { hour: '2-digit', minute: '2-digit' };

    if (sameDay) {
      return `${ds.toLocaleDateString('es-MX', optsDate)} · ${ds.toLocaleTimeString(
        'es-MX',
        optsTime
      )} – ${de.toLocaleTimeString('es-MX', optsTime)}`;
    }
    return `${ds.toLocaleDateString(
      'es-MX',
      optsDate
    )} · ${ds.toLocaleTimeString('es-MX', optsTime)} — ${de.toLocaleDateString(
      'es-MX',
      optsDate
    )} · ${de.toLocaleTimeString('es-MX', optsTime)}`;
  }

  if (ds) {
    const opts = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    return ds.toLocaleDateString('es-MX', opts);
  }

  return '';
};

const formatDateOnly = (start) => {
  if (!start) return '';
  const d = new Date(start);
  return d.toLocaleDateString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

const parsePrice = (price) => {
  if (price == null) return 0;
  if (typeof price === 'number') return price;
  const match = String(price).replace(',', '.').match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : 0;
};

const generateBookingCode = () => {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let code = 'CEART-';
  for (let i = 0; i < 6; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  return code;
};

// =======================
// Normalizador de eventos desde la API
// =======================
const normalizeApiEvent = (ev) => {
  let cover =
    ev.cover_image_url ||
    (Array.isArray(ev.images)
      ? (ev.images.find((img) => img.is_cover) || ev.images[0])?.url
      : null);

  const coverImage = buildImageUrl(cover);

  const gallery =
    Array.isArray(ev.images) && ev.images.length
      ? ev.images
          .slice()
          .sort((a, b) => (a.position || 0) - (b.position || 0))
          .map((img) => ({
            id: img.id,
            url: buildImageUrl(img.url),
            alt: img.alt || '',
            is_cover: !!img.is_cover,
            position: img.position || 0
          }))
      : [];

  return {
    id: ev.id,
    title: ev.title,
    summary: ev.summary,
    description: ev.description,
    fullDescription: ev.description || ev.summary,
    category: ev.category,
    location: ev.venue_name || ev.venue || '',
    start_at: ev.start_at,
    end_at: ev.end_at,
    status: ev.status,
    capacity_total: ev.capacity_total,
    capacity_reserved: ev.capacity_reserved,
    price: ev.price || ev.price_label || null,
    priceNumber: parsePrice(ev.price || ev.price_label),
    tags: ev.tags || [],
    coverImage,
    gallery
  };
};

// =======================
// Componente principal
// =======================
function App() {
  const [events, setEvents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const [uiStep, setUiStep] = React.useState('home'); // home, eventDetail, tickets, payment, confirmation

  const [currentEvent, setCurrentEvent] = React.useState(null);
  const [selectedSession, setSelectedSession] = React.useState(null);

  const [ticketQty, setTicketQty] = React.useState(1);
  const [serviceFeePerTicket] = React.useState(25.5);
  const [bookingInfo, setBookingInfo] = React.useState(null);

  const [activeNav, setActiveNav] = React.useState('inicio');

  const [baseLoaded, setBaseLoaded] = React.useState(false);
  const [imagesLoaded, setImagesLoaded] = React.useState(false);

  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [uiStep]);

  // 1) Carga básica de eventos
  React.useEffect(() => {
    const load = async () => {
      try {
        const now = new Date();
        const from = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
        const toDate = new Date(now);
        toDate.setMonth(toDate.getMonth() + 3);
        const to = `${toDate.getFullYear()}-${pad2(toDate.getMonth() + 1)}-${pad2(1)}`;

        const url = new URL(`${API_BASE}/events`);
        url.searchParams.set('page', '1');
        url.searchParams.set('pageSize', '300');
        url.searchParams.set('status', 'scheduled');
        url.searchParams.set('from', from);
        url.searchParams.set('to', to);

        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const rawItems = Array.isArray(data) ? data : data.items || [];
        const normalized = rawItems.map(normalizeApiEvent);

        normalized.sort((a, b) => {
          const da = a.start_at ? new Date(a.start_at) : new Date();
          const db = b.start_at ? new Date(b.start_at) : new Date();
          return da - db;
        });

        setEvents(normalized);
        setError(null);
        setBaseLoaded(true);
        setImagesLoaded(false);
      } catch (err) {
        console.error('Error cargando eventos desde la API', err);
        setError('No se pudieron cargar los eventos. Intenta nuevamente más tarde.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  // 2) Carga detallada de imágenes por evento
  React.useEffect(() => {
    if (!baseLoaded || imagesLoaded || !events.length) return;

    const enrich = async () => {
      try {
        const updated = await Promise.all(
          events.map(async (ev) => {
            try {
              const res = await fetch(`${API_BASE}/events/${ev.id}`);
              if (!res.ok) return ev;
              const full = await res.json();
              return normalizeApiEvent(full);
            } catch (e) {
              console.error('Error cargando imágenes de evento', ev.id, e);
              return ev;
            }
          })
        );
        setEvents(updated);
      } finally {
        setImagesLoaded(true);
      }
    };

    enrich();
  }, [baseLoaded, imagesLoaded, events]);

  // Agrupa eventos por fecha (YYYY-MM-DD)
  const eventsByDate = React.useMemo(() => {
    const map = {};
    events.forEach((ev) => {
      const key = dateKeyFromISO(ev.start_at);
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    });
    return map;
  }, [events]);

  // Slides para el carrusel
  const slides = events
    .filter((ev) => ev.coverImage)
    .slice(0, 6)
    .map((ev) => ({
      image: ev.coverImage,
      title: ev.title
    }));

  const goHome = () => {
    setUiStep('home');
    setActiveNav('inicio');
  };

  const handleEventClick = (event) => {
    setCurrentEvent(event);
    const session = {
      id: event.id,
      start_at: event.start_at,
      end_at: event.end_at,
      location: event.location
    };
    setSelectedSession(session);
    setUiStep('eventDetail');
  };

  const handleSelectSession = (session) => {
    setSelectedSession(session);
    setTicketQty(1);
    setUiStep('tickets');
  };

  const handleGoTickets = () => {
    if (!selectedSession && currentEvent) {
      const session = {
        id: currentEvent.id,
        start_at: currentEvent.start_at,
        end_at: currentEvent.end_at,
        location: currentEvent.location
      };
      setSelectedSession(session);
    }
    setUiStep('tickets');
  };

  const handleCreateBookingAndGoPayment = async () => {
    if (!currentEvent || !selectedSession) return;

    const basePrice = currentEvent.priceNumber || 0;
    const subtotal = basePrice * ticketQty;
    const serviceFee = serviceFeePerTicket * ticketQty;
    const total = subtotal + serviceFee;

    let backendBookingId = null;
    try {
      const res = await fetch(`${API_BASE}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: currentEvent.id,
          name: 'Visitante CEART',
          email: 'visitante@ceart.local',
          phone: '',
          qty: ticketQty,
          notes: 'Reserva generada desde el portal público de eventos.'
        })
      });
      if (res.ok) {
        const data = await res.json();
        backendBookingId = data.id || data.booking_id || null;
      } else {
        console.warn('El backend devolvió un código de error en /bookings:', res.status);
      }
    } catch (e) {
      console.warn('No fue posible registrar la reserva en el backend.', e);
    }

    const code = generateBookingCode();

    setBookingInfo({
      code,
      backendBookingId,
      qty: ticketQty,
      basePrice,
      serviceFeePerTicket,
      subtotal,
      serviceFee,
      total
    });

    setUiStep('payment');
  };

  const handleFinishPayment = () => {
    if (!currentEvent || !selectedSession || !bookingInfo) return;

    try {
      if (window.jspdf && window.jspdf.jsPDF) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const eventTitle = currentEvent.title || 'Evento CEART';
        const dateRange = formatRange(selectedSession.start_at, selectedSession.end_at);
        const location = selectedSession.location || currentEvent.location || '';

        doc.setFontSize(18);
        doc.text('Boleto CEART', 20, 25);

        doc.setFontSize(12);
        doc.text(`Evento: ${eventTitle}`, 20, 40);
        doc.text(`Fecha y hora: ${dateRange}`, 20, 50);
        doc.text(`Lugar: ${location}`, 20, 60);

        doc.text(`Cantidad de boletos: ${bookingInfo.qty}`, 20, 75);
        doc.text(`Total: $${bookingInfo.total.toFixed(2)} MXN`, 20, 85);

        doc.text(`Código de reservación: ${bookingInfo.code}`, 20, 100);

        doc.setFontSize(9);
        doc.text(
          'Este documento ha sido generado por el sistema de reservaciones CEART.',
          20,
          115
        );

        doc.save(`Boleto_CEART_${bookingInfo.code}.pdf`);
      } else {
        alert(
          'No fue posible generar el archivo PDF. Verifica la configuración de jsPDF en el documento principal.'
        );
      }
    } catch (e) {
      console.error('Error al generar el PDF de boletos', e);
      alert('Ocurrió un problema al generar el boleto en PDF.');
    }

    setUiStep('confirmation');
  };

  const handleNavClick = (sectionId, e) => {
    e.preventDefault();

    setUiStep('home');
    setActiveNav(sectionId);

    const scrollToSection = () => {
      const section = document.getElementById(sectionId);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    setTimeout(scrollToSection, 50);
  };

  return (
    <div className="app">
      <Header
        activeNav={activeNav}
        onNavClick={handleNavClick}
        onNextEventsClick={() => {
          setUiStep('home');
          setActiveNav('proximos-eventos');
          const section = document.getElementById('proximos-eventos');
          if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        onLogoClick={goHome}
      />

      {uiStep === 'home' && (
        <>
          <Carousel slides={slides.length ? slides : []} />

          <CalendarView
            eventsByDate={eventsByDate}
            loading={loading}
            error={error}
            onEventClick={handleEventClick}
          />

          <EventsSection
            events={events}
            loading={loading}
            error={error}
            onEventClick={handleEventClick}
          />
        </>
      )}

      {uiStep === 'eventDetail' && currentEvent && selectedSession && (
        <EventDetailPage
          event={currentEvent}
          session={selectedSession}
          onBack={goHome}
          onSelectSession={handleSelectSession}
          onGoTickets={handleGoTickets}
        />
      )}

      {uiStep === 'tickets' && currentEvent && selectedSession && (
        <TicketsPage
          event={currentEvent}
          session={selectedSession}
          qty={ticketQty}
          setQty={setTicketQty}
          serviceFeePerTicket={serviceFeePerTicket}
          onBack={() => setUiStep('eventDetail')}
          onContinue={handleCreateBookingAndGoPayment}
        />
      )}

      {uiStep === 'payment' && currentEvent && selectedSession && bookingInfo && (
        <PaymentPage
          event={currentEvent}
          session={selectedSession}
          bookingInfo={bookingInfo}
          onBack={() => setUiStep('tickets')}
          onFinish={handleFinishPayment}
        />
      )}

      {uiStep === 'confirmation' && currentEvent && selectedSession && bookingInfo && (
        <ConfirmationPage
          event={currentEvent}
          session={selectedSession}
          bookingInfo={bookingInfo}
          onBack={goHome}
        />
      )}

      <Footer />
    </div>
  );
}

// =======================
// Encabezado
// =======================
function Header({ activeNav, onNavClick, onNextEventsClick, onLogoClick }) {
  return (
    <header>
      <div className="blocks-background">
        <div className="block block-1"></div>
        <div className="block block-2"></div>
        <div className="block block-3"></div>
        <div className="block block-4"></div>
        <div className="block block-5"></div>
        <div className="block block-6"></div>
        <div className="block block-7"></div>
        <div className="block block-8"></div>
        <div className="block block-9"></div>
        <div className="block block-10"></div>
      </div>

      <div className="container">
        <div className="header-top">
          <div className="logo" onClick={onLogoClick} style={{ cursor: 'pointer' }}>
            <img src="logos/logos.png" alt="Centro de las Artes" className="logo-img" />
          </div>
          <div className="header-right">
            <div className="social-icons">
              <a
                href="https://www.facebook.com/centrodelasartesslp/?locale=es_LA"
                target="_blank"
              >
                <img src="logos/face.png" alt="Facebook" className="social-icon" />
              </a>
              <a href="https://x.com/CEARTSLP" target="_blank">
                <img src="logos/tw.png" alt="X (Twitter)" className="social-icon" />
              </a>
              <a href="https://www.instagram.com/ceart_sanluis/" target="_blank">
                <img src="logos/ig.png" alt="Instagram" className="social-icon" />
              </a>
            </div>
          </div>
        </div>

        <nav className="main-nav">
          <ul>
            <li>
              <a
                href="#inicio"
                className={`nav-link ${activeNav === 'inicio' ? 'active' : ''}`}
                onClick={(e) => onNavClick('inicio', e)}
              >
                Inicio
              </a>
            </li>
            <li>
              <a
                href="#actividades-hoy"
                className={`nav-link ${activeNav === 'actividades-hoy' ? 'active' : ''}`}
                onClick={(e) => onNavClick('actividades-hoy', e)}
              >
                Actividades de hoy
              </a>
            </li>
            <li>
              <a
                href="#eventos-mes"
                className={`nav-link ${activeNav === 'eventos-mes' ? 'active' : ''}`}
                onClick={(e) => onNavClick('eventos-mes', e)}
              >
                Eventos del mes
              </a>
            </li>
            <li>
              <a
                href="#proximos-eventos"
                className={`nav-link ${activeNav === 'proximos-eventos' ? 'active' : ''}`}
                onClick={onNextEventsClick}
              >
                Próximos eventos
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

// =======================
// Carrusel
// =======================
function Carousel({ slides }) {
  const [currentSlide, setCurrentSlide] = React.useState(0);
  const [isPaused, setIsPaused] = React.useState(false);

  React.useEffect(() => {
    if (!slides.length || isPaused) return;
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [slides, isPaused]);

  if (!slides.length) {
    return (
      <section className="announcements-carousel" id="inicio">
        <div className="carousel-container" />
      </section>
    );
  }

  const handleMouseEnter = () => setIsPaused(true);
  const handleMouseLeave = () => setIsPaused(false);

  return (
    <section
      className="announcements-carousel"
      id="inicio"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="carousel-container">
        <div
          className="carousel-slides"
          style={{
            transform: `translateX(-${currentSlide * 100}%)`,
            transition: 'transform 0.5s ease-in-out'
          }}
        >
          {slides.map((slide, index) => (
            <div key={index} className="carousel-slide">
              <img
                src={slide.image || FALLBACK_IMG}
                alt={slide.title || `Evento ${index + 1}`}
                loading="eager"
                onError={(e) => {
                  e.target.src = FALLBACK_IMG;
                }}
                className="carousel-image"
              />
            </div>
          ))}
        </div>

        <button
          className="carousel-arrow carousel-arrow-left"
          onClick={() =>
            setCurrentSlide((prev) => (prev === 0 ? slides.length - 1 : prev - 1))
          }
        >
          ‹
        </button>
        <button
          className="carousel-arrow carousel-arrow-right"
          onClick={() => setCurrentSlide((prev) => (prev + 1) % slides.length)}
        >
          ›
        </button>

        <div className="carousel-progress">
          <div className="carousel-progress-bar"></div>
        </div>
      </div>
    </section>
  );
}

// =======================
// Calendario / Actividades de hoy
// =======================
function CalendarView({ eventsByDate, loading, error, onEventClick }) {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(
    today.getDate()
  )}`;

  const [currentMonth, setCurrentMonth] = React.useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selectedDateKey, setSelectedDateKey] = React.useState(todayKey);

  React.useEffect(() => {
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    const newKey = `${y}-${pad2(m + 1)}-01`;
    setSelectedDateKey((prev) => {
      const [py, pm] = prev.split('-');
      if (Number(py) === y && Number(pm) === m + 1) return prev;
      return newKey;
    });
  }, [currentMonth]);

  const year = currentMonth.getFullYear();
  const monthIndex = currentMonth.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const monthName = currentMonth.toLocaleDateString('es-MX', {
    month: 'long',
    year: 'numeric'
  });

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(year, monthIndex - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(year, monthIndex + 1, 1));
  };

  const eventsForSelectedDate = eventsByDate[selectedDateKey] || [];

  return (
    <section className="calendar-section" id="actividades-hoy">
      <div className="container">
        <h2 className="section-title">Actividades de hoy</h2>
        <p className="section-subtitle">
          Consulta la agenda y encuentra las actividades disponibles para esta fecha.
        </p>

        {loading && <p className="no-events">Cargando calendario…</p>}
        {error && !loading && <p className="no-events">{error}</p>}

        {!loading && !error && (
          <>
            <div className="calendar-header-row">
              <button className="calendar-nav-btn" onClick={handlePrevMonth}>
                ‹
              </button>
              <div className="calendar-month-label">
                {monthName.charAt(0).toUpperCase() + monthName.slice(1)}
              </div>
              <button className="calendar-nav-btn" onClick={handleNextMonth}>
                ›
              </button>
            </div>

            <div className="calendar-days-row">
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const key = `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
                const hasEvents = !!eventsByDate[key];
                const isSelected = key === selectedDateKey;

                return (
                  <button
                    key={key}
                    className={
                      'calendar-day' +
                      (isSelected ? ' calendar-day-selected' : '') +
                      (hasEvents ? ' calendar-day-has-events' : '')
                    }
                    onClick={() => setSelectedDateKey(key)}
                  >
                    <span className="calendar-day-number">{day}</span>
                    {hasEvents && <span className="calendar-day-dot"></span>}
                  </button>
                );
              })}
            </div>

            <div className="calendar-events-container">
              <div className="calendar-date-title">
                {(() => {
                  const [y, m, d] = selectedDateKey.split('-').map(Number);
                  const dObj = new Date(y, m - 1, d);
                  const label = dObj.toLocaleDateString('es-MX', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long'
                  });
                  return (
                    <>
                      <span className="calendar-big-day">{d}</span>
                      <span className="calendar-big-info">
                        {label.toUpperCase()}
                        <span className="calendar-activities-count">
                          {eventsForSelectedDate.length} actividad
                          {eventsForSelectedDate.length !== 1 ? 'es' : ''}
                        </span>
                      </span>
                    </>
                  );
                })()}
              </div>

              {eventsForSelectedDate.length === 0 ? (
                <p className="no-events">
                  No hay actividades programadas para este día.
                </p>
              ) : (
                <div className="calendar-events-list">
                  {eventsForSelectedDate.map((ev) => {
                    const timeLabel = ev.start_at
                      ? new Date(ev.start_at).toLocaleTimeString('es-MX', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : '';
                    const imgSrc =
                      ev.coverImage ||
                      (ev.gallery && ev.gallery[0]?.url) ||
                      FALLBACK_IMG;

                    return (
                      <div
                        key={ev.id}
                        className="calendar-event-item"
                        onClick={() => onEventClick(ev)}
                      >
                        <div className="calendar-event-thumb">
                          <img
                            src={imgSrc}
                            alt={ev.title}
                            onError={(e) => {
                              e.target.src = FALLBACK_IMG;
                            }}
                          />
                        </div>
                        <div className="calendar-event-info">
                          <div className="calendar-event-time">{timeLabel}</div>
                          <div className="calendar-event-title">{ev.title}</div>
                          <div className="calendar-event-location">
                            {ev.location}
                          </div>
                        </div>
                        <div className="calendar-event-cta">Ver detalles</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// =======================
// Sección "Eventos del mes"
// =======================
function EventsSection({ events, loading, error, onEventClick }) {
  return (
    <section className="events-section" id="eventos-mes">
      <div className="container">
        <h2 className="section-title">Eventos de este mes</h2>

        {loading && <p className="no-events">Cargando eventos…</p>}

        {error && !loading && <p className="no-events">{error}</p>}

        {!loading && !error && (
          <div className="events-grid">
            {events.length > 0 ? (
              events.map((event) => (
                <EventCard key={event.id} event={event} onClick={() => onEventClick(event)} />
              ))
            ) : (
              <p className="no-events">No hay eventos programados en este momento.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// =======================
// Tarjeta de evento individual
// =======================
function EventCard({ event, onClick }) {
  const dateLabel = formatDateOnly(event.start_at);
  const imgSrc =
    event.coverImage || (event.gallery && event.gallery[0]?.url) || FALLBACK_IMG;

  return (
    <div className="event-card" onClick={onClick}>
      <div className="event-image">
        <img
          src={imgSrc}
          alt={event.title}
          onError={(e) => {
            e.target.src = FALLBACK_IMG;
          }}
        />
      </div>
      <div className="event-content">
        <div className="event-date">{dateLabel}</div>
        <h3 className="event-title">{event.title}</h3>
        {event.location && <div className="event-location">{event.location}</div>}
        <p className="event-description">{event.summary || event.description}</p>
        {event.category && <span className="event-category">{event.category}</span>}
      </div>
    </div>
  );
}

// =======================
// Página de detalle del evento
// =======================
function EventDetailPage({ event, session, onBack, onSelectSession, onGoTickets }) {
  const imgSrc =
    event.coverImage || (event.gallery && event.gallery[0]?.url) || FALLBACK_IMG;

  const sessions = event.sessions && event.sessions.length
    ? event.sessions
    : [
        {
          id: session.id,
          start_at: session.start_at,
          end_at: session.end_at,
          location: session.location || event.location
        }
      ];

  const handleDownloadProgram = () => {
    try {
      if (window.jspdf && window.jspdf.jsPDF) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const rangeLabel = formatRange(session.start_at, session.end_at);
        const location = session.location || event.location || '';

        doc.setFontSize(18);
        doc.text('Programa de mano', 20, 25);

        doc.setFontSize(12);
        doc.text(`Evento: ${event.title || 'Evento CEART'}`, 20, 40);
        doc.text(`Fecha y hora: ${rangeLabel || 'Por definir'}`, 20, 50);
        doc.text(`Lugar: ${location}`, 20, 60);

        doc.setFontSize(11);
        doc.text('Descripción:', 20, 75);

        const desc =
          event.fullDescription || event.description || event.summary || 'Descripción pendiente.';
        const splitDesc = doc.splitTextToSize(desc, 170);
        doc.text(splitDesc, 20, 82);

        doc.setFontSize(9);
        doc.text(
          'Documento informativo generado por el sistema de eventos CEART.',
          20,
          120
        );

        doc.save(`Programa_${(event.title || 'Evento_CEART').slice(0, 30)}.pdf`);
      } else {
        alert(
          'No fue posible generar el programa en PDF. Verifica la configuración de jsPDF en el documento principal.'
        );
      }
    } catch (e) {
      console.error('Error al generar el programa de mano', e);
      alert('Ocurrió un problema al generar el programa en PDF.');
    }
  };

  return (
    <section className="event-detail-page">
      <div className="container">
        <button className="back-button" onClick={onBack}>
          ‹ Regresar
        </button>

        <div className="event-detail-hero">
          <div className="event-detail-banner">
            {event.category && (
              <span className="event-detail-category">
                {event.category.toUpperCase()}
              </span>
            )}
            <h1 className="event-detail-title">{event.title}</h1>
          </div>
        </div>

        <div className="event-detail-layout">
          <div className="event-detail-left">
            <h2 className="event-detail-subtitle">Próximas funciones</h2>
            <p className="event-detail-subtext">
              Selecciona la fecha y horario que más te convenga.
            </p>

            <div className="event-detail-sessions">
              {sessions.map((s) => {
                const rangeLabel = formatRange(s.start_at, s.end_at);
                return (
                  <button
                    key={s.id}
                    className="event-detail-session-card"
                    onClick={() => onSelectSession(s)}
                  >
                    <div className="session-date-label">
                      {s.start_at
                        ? new Date(s.start_at).toLocaleDateString('es-MX', {
                            weekday: 'short',
                            day: '2-digit',
                            month: 'short'
                          })
                        : 'Fecha por definir'}
                    </div>
                    <div className="session-main-info">
                      <div className="session-title">{event.title}</div>
                      <div className="session-location">
                        {s.location || event.location || 'Lugar por definir'}
                      </div>
                      <div className="session-range">{rangeLabel}</div>
                    </div>
                    <div className="session-cta">Elegir función</div>
                  </button>
                );
              })}
            </div>

            <button className="primary-btn" onClick={onGoTickets}>
              Continuar a selección de boletos
            </button>
          </div>

          <div className="event-detail-right">
            <h3 className="event-detail-subtitle">Información adicional</h3>

            <div className="event-detail-image-card">
              <img
                src={imgSrc}
                alt={event.title}
                onError={(e) => {
                  e.target.src = FALLBACK_IMG;
                }}
              />
            </div>

            <button
              className="link-btn"
              type="button"
              onClick={handleDownloadProgram}
            >
              Descargar programa de mano
            </button>

            <h4 className="event-detail-desc-title">Descripción completa</h4>
            <p className="event-detail-description">
              {event.fullDescription || event.description || event.summary || ''}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// =======================
// Página de selección de boletos
// =======================
function TicketsPage({
  event,
  session,
  qty,
  setQty,
  serviceFeePerTicket,
  onBack,
  onContinue
}) {
  const basePrice = event.priceNumber || 0;
  const subtotal = basePrice * qty;
  const serviceFee = serviceFeePerTicket * qty;
  const total = subtotal + serviceFee;

  const handleChangeQty = (delta) => {
    setQty((prev) => {
      const next = prev + delta;
      if (next < 1) return 1;
      if (next > 10) return 10;
      return next;
    });
  };

  const rangeLabel = formatRange(session.start_at, session.end_at);

  return (
    <section className="tickets-page">
      <div className="container">
        <button className="back-button" onClick={onBack}>
          ‹ Regresar
        </button>

        <div className="tickets-layout">
          <div className="tickets-left">
            <h2>Selecciona tus boletos</h2>
            <p className="tickets-event-title">{event.title}</p>
            <p className="tickets-event-info">
              {session.location || event.location} · {rangeLabel || 'Fecha por definir'}
            </p>

            <div className="tickets-card">
              <div className="tickets-row">
                <div>
                  <div className="tickets-label">GENERAL</div>
                  <div className="tickets-price">
                    {basePrice > 0 ? `$${basePrice.toFixed(2)} MXN` : 'Entrada libre'}
                  </div>
                </div>
              </div>

              <div className="tickets-qty-row">
                <span>Cantidad de boletos</span>
                <div className="qty-control">
                  <button onClick={() => handleChangeQty(-1)}>-</button>
                  <span>{qty}</span>
                  <button onClick={() => handleChangeQty(1)}>+</button>
                </div>
              </div>

              <div className="tickets-summary">
                <div className="tickets-summary-row">
                  <span>Subtotal</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                <div className="tickets-summary-row">
                  <span>
                    Cargo por servicio{' '}
                    {serviceFeePerTicket > 0 ? `($${serviceFeePerTicket.toFixed(2)} c/u)` : ''}
                  </span>
                  <span>${serviceFee.toFixed(2)}</span>
                </div>
                <div className="tickets-summary-row total">
                  <span>Total</span>
                  <span>${total.toFixed(2)} MXN</span>
                </div>
              </div>
            </div>

            <button className="primary-btn" onClick={onContinue}>
              Continuar al pago
            </button>
          </div>

          <div className="tickets-right">
            <div className="tickets-info-box">
              <h3>Información importante</h3>
              <ul>
                <li>Verifica tus datos antes de continuar con la reserva.</li>
                <li>
                  El comprobante en PDF se genera al finalizar el proceso de pago.
                </li>
                <li>
                  Para integrar un proveedor de pagos real, se puede enlazar este flujo a la
                  pasarela correspondiente.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// =======================
// Página de pago
// =======================
function PaymentPage({ event, session, bookingInfo, onBack, onFinish }) {
  const [method, setMethod] = React.useState('card');
  const [acceptTerms, setAcceptTerms] = React.useState(false);

  const disabled = !acceptTerms || !method;

  const rangeLabel = formatRange(session.start_at, session.end_at);

  return (
    <section className="payment-page">
      <div className="container">
        <button className="back-button" onClick={onBack}>
          ‹ Regresar
        </button>

        <div className="payment-layout">
          <div className="payment-left">
            <h2>Forma de entrega de boletos</h2>
            <p className="payment-info">
              Tus boletos se generarán en formato PDF al finalizar el proceso.
            </p>

            <div className="payment-card">
              <div className="payment-option selected">
                <div>
                  <div className="payment-option-title">Boletos en PDF</div>
                  <div className="payment-option-sub">Descarga inmediata</div>
                </div>
                <div className="payment-option-badge">$0.00</div>
              </div>
            </div>

            <h3 className="payment-subtitle">Selecciona tu método de pago</h3>

            <div className="payment-methods">
              <button
                className={
                  'payment-method' + (method === 'card' ? ' payment-method-selected' : '')
                }
                onClick={() => setMethod('card')}
              >
                <div className="payment-method-title">Tarjeta bancaria</div>
                <div className="payment-method-sub">Visa / Mastercard</div>
              </button>

              <button
                className={
                  'payment-method' + (method === 'oxxo' ? ' payment-method-selected' : '')
                }
                onClick={() => setMethod('oxxo')}
              >
                <div className="payment-method-title">Pago en efectivo</div>
                <div className="payment-method-sub">Oxxo u otros centros de pago</div>
              </button>
            </div>

            <label className="terms-checkbox">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
              />
              <span>
                He leído y acepto los términos y condiciones, así como el aviso de
                privacidad.
              </span>
            </label>

            <button
              className="primary-btn"
              disabled={disabled}
              onClick={onFinish}
              style={{ marginTop: '1rem' }}
            >
              Confirmar pago y generar boletos
            </button>
          </div>

          <div className="payment-right">
            <div className="payment-summary">
              <h3>Resumen de la compra</h3>
              <p className="payment-event-title">{event.title}</p>
              <p className="payment-event-info">
                {session.location || event.location} · {rangeLabel || 'Fecha por definir'}
              </p>

              <div className="tickets-summary">
                <div className="tickets-summary-row">
                  <span>GENERAL x {bookingInfo.qty}</span>
                  <span>${bookingInfo.subtotal.toFixed(2)}</span>
                </div>
                <div className="tickets-summary-row">
                  <span>Cargo por servicio</span>
                  <span>${bookingInfo.serviceFee.toFixed(2)}</span>
                </div>
                <div className="tickets-summary-row total">
                  <span>Total</span>
                  <span>${bookingInfo.total.toFixed(2)} MXN</span>
                </div>
              </div>

              <p className="payment-note">
                Código de reservación: <strong>{bookingInfo.code}</strong>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// =======================
// Página de confirmación
// =======================
function ConfirmationPage({ event, session, bookingInfo, onBack }) {
  const rangeLabel = formatRange(session.start_at, session.end_at);

  return (
    <section className="confirmation-page">
      <div className="container">
        <div className="confirmation-card">
          <h2>Operación completada</h2>
          <p className="confirmation-text">
            La reserva se ha registrado correctamente y se generó el boleto en formato PDF.
          </p>

          <div className="confirmation-info">
            <p>
              <strong>Evento:</strong> {event.title}
            </p>
            <p>
              <strong>Fecha y hora:</strong> {rangeLabel || 'Por definir'}
            </p>
            <p>
              <strong>Lugar:</strong> {session.location || event.location}
            </p>
            <p>
              <strong>Cantidad de boletos:</strong> {bookingInfo.qty}
            </p>
            <p>
              <strong>Total:</strong> ${bookingInfo.total.toFixed(2)} MXN
            </p>
            <p>
              <strong>Código de reservación:</strong> {bookingInfo.code}
            </p>
          </div>

          <button className="primary-btn" onClick={onBack}>
            Volver al inicio
          </button>
        </div>
      </div>
    </section>
  );
}

// =======================
// Pie de página
// =======================
function Footer() {
  return (
    <footer id="proximos-eventos">
      <div className="container">
        <div className="footer-content">
          <div className="footer-section footer-left">
            <img
              src="logos/logos.png"
              alt="Centro de las Artes"
              className="footer-logo"
            />
            <p className="footer-slogan">
              Promoviendo la cultura y las artes en nuestra comunidad.
            </p>
          </div>

          <div className="footer-section footer-center">
            <div className="footer-section-header">
              <img
                src="logos/contacto.png"
                alt="Contacto"
                className="footer-icon"
              />
              <h3>Contacto</h3>
            </div>
            <div className="contact-info">
              <div className="contact-item">
                <img
                  src="logos/email.png"
                  alt="Correo electrónico"
                  className="contact-icon"
                />
                <span className="contact-text elegant-text">
                  inscripciones.av.ceart@gmail.com
                </span>
              </div>
              <div className="contact-item">
                <img
                  src="logos/tel.png"
                  alt="Teléfono"
                  className="contact-icon"
                />
                <span className="contact-text elegant-text">
                  444-356-5896
                </span>
              </div>
            </div>
          </div>

          <div className="footer-section footer-right">
            <div className="footer-section-header">
              <img src="logos/ubi.png" alt="Ubicación" className="footer-icon" />
              <h3>Ubicación</h3>
            </div>
            <div className="map-container">
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m16!1m12!1m3!1d951215.2589126606!2d-101.34275116134474!3d21.362932238810075!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!2m1!1sCEART!5e0!3m2!1ses!2smx!4v1762725018427!5m2!1ses!2smx"
                width="100%"
                height="200"
                style={{ border: 0, borderRadius: '8px' }}
                allowFullScreen=""
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              ></iframe>
              <p className="map-link">
                <a
                  href="https://maps.app.goo.gl/NDpDaPMn1YMacyTK9"
                  target="_blank"
                  className="elegant-text"
                >
                  Ver en Google Maps
                </a>
              </p>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; 2025 Centro de las Artes. Todos los derechos reservados.</p>
        </div>
      </div>
    </footer>
  );
}

// =======================
// Render (React 18)
// =======================
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
