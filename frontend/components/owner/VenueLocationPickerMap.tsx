"use client";

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

export type MapPosition = {
  latitude: number;
  longitude: number;
};

const defaultCenter: [number, number] = [27.7172, 85.3240];

const venuePin = L.divIcon({
  className: "sportspot-map-pin-wrap",
  html: '<span class="sportspot-map-pin" aria-hidden="true"></span>',
  iconSize: [28, 36],
  iconAnchor: [14, 34],
});

function MapPositionSync({ position }: { position: MapPosition | null }) {
  const map = useMap();

  useEffect(() => {
    if (position) {
      map.setView([position.latitude, position.longitude], Math.max(map.getZoom(), 16), { animate: true });
    }
  }, [map, position?.latitude, position?.longitude]);

  return null;
}

function MapClickHandler({ onPositionChange }: { onPositionChange?: (position: MapPosition) => void }) {
  useMapEvents({
    click(event) {
      onPositionChange?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  return null;
}

export default function VenueLocationPickerMap({
  position,
  onPositionChange,
}: {
  position: MapPosition | null;
  onPositionChange?: (position: MapPosition) => void;
}) {
  const center: [number, number] = position
    ? [position.latitude, position.longitude]
    : defaultCenter;
  const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const attribution = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || "&copy; OpenStreetMap contributors";

  return (
    <MapContainer
      center={center}
      className="h-full min-h-[290px] w-full rounded-xl"
      maxBounds={[[26.3, 80.0], [30.5, 88.3]]}
      maxBoundsViscosity={0.85}
      minZoom={6}
      scrollWheelZoom
      zoom={position ? 16 : 12}
    >
      <TileLayer attribution={attribution} url={tileUrl} />
      {onPositionChange ? <MapClickHandler onPositionChange={onPositionChange} /> : null}
      <MapPositionSync position={position} />
      {position ? (
        <Marker
          draggable={Boolean(onPositionChange)}
          eventHandlers={onPositionChange ? {
            dragend(event) {
              const marker = event.target as L.Marker;
              const point = marker.getLatLng();
              onPositionChange({ latitude: point.lat, longitude: point.lng });
            },
          } : undefined}
          icon={venuePin}
          position={[position.latitude, position.longitude]}
        />
      ) : null}
    </MapContainer>
  );
}
