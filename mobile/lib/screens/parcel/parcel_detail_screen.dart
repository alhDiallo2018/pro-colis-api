// mobile/lib/screens/parcel/parcel_detail_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procolis/models/parcel.dart';
import 'package:procolis/services/api_service.dart';
import 'package:procolis/widgets/video_player_widget.dart';

import '../../providers/auth_provider.dart';
import '../../widgets/status_timeline.dart';

class ParcelDetailScreen extends ConsumerStatefulWidget {
  final Parcel parcel;

  const ParcelDetailScreen({super.key, required this.parcel});

  @override
  ConsumerState<ParcelDetailScreen> createState() => _ParcelDetailScreenState();
}

class _ParcelDetailScreenState extends ConsumerState<ParcelDetailScreen> {
  final ApiService _apiService = ApiService();
  List<ParcelEvent> _events = [];
  bool _isLoadingEvents = true;
  bool _isUpdating = false;
  late Parcel _parcel;

  @override
  void initState() {
    super.initState();
    _parcel = widget.parcel;
    _loadEvents();
    _loadParcelDetails();
  }

  Future<void> _loadParcelDetails() async {
    try {
      final updatedParcel = await _apiService.getParcelById(_parcel.id);
      if (updatedParcel != null && mounted) {
        setState(() {
          _parcel = updatedParcel;
        });
      }
    } catch (e) {
      debugPrint('⚠️ Impossible de charger les détails complets: $e');
    }
  }

  Future<void> _loadEvents() async {
    setState(() => _isLoadingEvents = true);
    try {
      final events = await _apiService.getParcelEvents(_parcel.id);
      if (mounted) {
        setState(() {
          _events = events;
          _isLoadingEvents = false;
        });
      }
    } catch (e) {
      debugPrint('⚠️ Impossible de charger les événements: $e');
      if (mounted) {
        setState(() {
          _events = [];
          _isLoadingEvents = false;
        });
      }
    }
  }

  Future<void> _updateStatus(String newStatus) async {
    setState(() => _isUpdating = true);
    try {
      final updatedParcel = await _apiService.updateParcelStatus(
        _parcel.id,
        newStatus,
      );
      if (mounted) {
        setState(() {
          _parcel = updatedParcel;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Statut mis à jour avec succès'), backgroundColor: Colors.green),
        );
        await _loadEvents();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isUpdating = false);
    }
  }

  Future<void> _acceptParcel() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Accepter le colis'),
        content: Text('Voulez-vous accepter la livraison du colis ${_parcel.trackingNumber} ?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Annuler'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
            child: const Text('Accepter'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await _updateStatus('picked_up');
    }
  }

  Future<void> _confirmDelivery() async {
    final notesController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirmation de livraison'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Confirmez-vous la livraison du colis ?'),
            const SizedBox(height: 12),
            TextField(
              controller: notesController,
              decoration: const InputDecoration(
                hintText: 'Notes (optionnel)',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Annuler'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
            child: const Text('Confirmer'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await _updateStatus('delivered');
    }
    notesController.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final user = authState.user;
    final isDriver = user?.isDriver ?? false;
    final isAdmin = user?.isAdmin ?? false;

    return Scaffold(
      appBar: AppBar(
        title: Text(_parcel.trackingNumber),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () async {
              await _loadParcelDetails();
              await _loadEvents();
            },
            tooltip: 'Actualiser',
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildInfoCard(),
            const SizedBox(height: 16),
            _buildStatusCard(),
            const SizedBox(height: 16),
            _buildTimelineSection(),
            const SizedBox(height: 16),
            if ((isDriver || isAdmin) && !_parcel.isFinished)
              _buildActionsSection(),
            const SizedBox(height: 80),
          ],
        ),
      ),
    );
  }

  // ==================== CARTE D'INFORMATION ====================

  Widget _buildInfoCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Informations du colis',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            
            _buildSectionTitle('Suivi', Icons.numbers),
            _buildInfoRow('Numéro de suivi', _parcel.trackingNumber, Icons.qr_code),
            const Divider(),
            
            _buildSectionTitle('Expéditeur', Icons.person_outline),
            _buildInfoRow('Nom', _parcel.senderName, Icons.person),
            _buildInfoRow('Téléphone', _parcel.senderPhone, Icons.phone),
            if (_parcel.senderId.isNotEmpty)
              _buildInfoRow('ID Expéditeur', _parcel.senderId.substring(0, 8), Icons.badge),
            const Divider(),
            
            _buildSectionTitle('Destinataire', Icons.person),
            _buildInfoRow('Nom', _parcel.receiverName, Icons.person),
            _buildInfoRow('Téléphone', _parcel.receiverPhone, Icons.phone),
            if (_parcel.receiverEmail != null && _parcel.receiverEmail!.isNotEmpty)
              _buildInfoRow('Email', _parcel.receiverEmail!, Icons.email),
            if (_parcel.receiverAddress != null && _parcel.receiverAddress!.isNotEmpty)
              _buildInfoRow('Adresse', _parcel.receiverAddress!, Icons.location_on),
            const Divider(),
            
            _buildSectionTitle('Détails du colis', Icons.inventory),
            _buildInfoRow('Description', _parcel.description, Icons.description),
            _buildInfoRow('Poids', '${_parcel.weight} kg', Icons.fitness_center),
            _buildInfoRow('Type', _parcel.type.label, Icons.category),
            if (_parcel.length != null || _parcel.width != null || _parcel.height != null)
              _buildInfoRow('Dimensions', _getDimensions(), Icons.crop),
            if (_parcel.volume > 0)
              _buildInfoRow('Volume', _parcel.formattedVolume, Icons.calculate),
            const Divider(),
            
            _buildSectionTitle('Informations financières', Icons.money),
            if (_parcel.price != null)
              _buildInfoRow('Prix', _parcel.formattedPrice, Icons.attach_money),
            if (_parcel.deliveryFees != null)
              _buildInfoRow('Frais de livraison', _parcel.formattedDeliveryFees, Icons.local_shipping),
            if (_parcel.totalAmount != null)
              _buildInfoRow('Montant total', _parcel.formattedTotal, Icons.receipt),
            if (_parcel.isUrgent && _parcel.urgentFee != null)
              _buildInfoRow('Frais urgent', '${_parcel.urgentFee!.toInt()} FCFA', Icons.flash_on),
            if (_parcel.isInsured && _parcel.insuranceAmount != null)
              _buildInfoRow('Assurance', '${_parcel.insuranceAmount!.toInt()} FCFA', Icons.shield),
            const Divider(),
            
            _buildSectionTitle('Paiement', Icons.payment),
            if (_parcel.paymentMethod != null)
              _buildInfoRow('Mode de paiement', _getPaymentMethodLabel(_parcel.paymentMethod!), Icons.wallet),
            if (_parcel.paymentStatus != null)
              _buildInfoRow('Statut paiement', _getPaymentStatusLabel(_parcel.paymentStatus!), Icons.receipt),
            const Divider(),
            
            _buildSectionTitle('Trajet', Icons.route),
            _buildInfoRow('Garage départ', _parcel.departureGarageName, Icons.departure_board),
            if (_parcel.arrivalGarageName != null && _parcel.arrivalGarageName!.isNotEmpty)
              _buildInfoRow('Garage arrivée', _parcel.arrivalGarageName!, Icons.location_on),
            const Divider(),
            
            if (_parcel.hasDriver) ...[
              _buildSectionTitle('Chauffeur', Icons.delivery_dining),
              if (_parcel.driverName != null)
                _buildInfoRow('Nom', _parcel.driverName!, Icons.person),
              if (_parcel.driverPhone != null)
                _buildInfoRow('Téléphone', _parcel.driverPhone!, Icons.phone),
              if (_parcel.driverId != null)
                _buildInfoRow('ID Chauffeur', _parcel.driverId!.substring(0, 8), Icons.badge),
              const Divider(),
            ],
            
            _buildSectionTitle('Dates importantes', Icons.calendar_today),
            _buildInfoRow('Création', _formatDate(_parcel.createdAt), Icons.create),
            if (_parcel.pickupDate != null)
              _buildInfoRow('Ramassage', _formatDate(_parcel.pickupDate!), Icons.inventory),
            if (_parcel.deliveryDate != null)
              _buildInfoRow('Livraison', _formatDate(_parcel.deliveryDate!), Icons.check_circle),
            if (_parcel.estimatedDeliveryDate != null)
              _buildInfoRow('Estimée', _formatDate(_parcel.estimatedDeliveryDate!), Icons.schedule),
            if (_parcel.updatedAt != null)
              _buildInfoRow('Dernière mise à jour', _formatDate(_parcel.updatedAt!), Icons.update),
            const Divider(),
            
            if (_parcel.isCancelled) ...[
              _buildSectionTitle('Annulation', Icons.cancel, color: Colors.red),
              if (_parcel.cancelledBy != null)
                _buildInfoRow('Annulé par', _parcel.cancelledBy!, Icons.person),
              if (_parcel.cancellationReason != null)
                _buildInfoRow('Raison', _parcel.cancellationReason!, Icons.message),
              if (_parcel.cancelledAt != null)
                _buildInfoRow('Date', _formatDate(_parcel.cancelledAt!), Icons.calendar_today),
              const Divider(),
            ],
            
            if (_parcel.notes != null && _parcel.notes!.isNotEmpty) ...[
              _buildSectionTitle('Notes', Icons.note),
              Padding(
                padding: const EdgeInsets.only(left: 36),
                child: Text(
                  _parcel.notes!,
                  style: const TextStyle(fontSize: 13, fontStyle: FontStyle.italic),
                ),
              ),
              const SizedBox(height: 8),
              const Divider(),
            ],
            
            _buildSectionTitle('Options', Icons.settings),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _buildOptionChip('Urgent', _parcel.isUrgent, Colors.red),
                _buildOptionChip('Assuré', _parcel.isInsured, Colors.blue),
                _buildOptionChip('Payé', _parcel.isPaid, Colors.green),
                _buildOptionChip('Chauffeur assigné', _parcel.hasDriver, Colors.orange),
                _buildOptionChip('En cours', _parcel.isInProgress, Colors.purple),
                _buildOptionChip('Terminé', _parcel.isFinished, Colors.teal),
              ],
            ),
            
            // PHOTOS
            if (_parcel.photoUrls.isNotEmpty) ...[
              const SizedBox(height: 16),
              _buildSectionTitle('Photos', Icons.photo_library),
              const SizedBox(height: 8),
              SizedBox(
                height: 120,
                child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  itemCount: _parcel.photoUrls.length,
                  itemBuilder: (context, index) {
                    return _buildPhotoThumbnail(_parcel.photoUrls[index]);
                  },
                ),
              ),
            ],
            
            // VIDÉOS
            if (_parcel.videoUrls.isNotEmpty) ...[
              const SizedBox(height: 16),
              _buildSectionTitle('Vidéos', Icons.video_library),
              const SizedBox(height: 8),
              SizedBox(
                height: 120,
                child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  itemCount: _parcel.videoUrls.length,
                  itemBuilder: (context, index) {
                    return _buildVideoThumbnail(_parcel.videoUrls[index]);
                  },
                ),
              ),
            ],
            
            // SIGNATURE
            if (_parcel.signatureUrl != null && _parcel.signatureUrl!.isNotEmpty) ...[
              const SizedBox(height: 16),
              _buildSectionTitle('Signature de livraison', Icons.edit),
              const SizedBox(height: 8),
              Container(
                height: 100,
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.grey.shade300),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Image.network(
                  _parcel.signatureUrl!,
                  fit: BoxFit.contain,
                  errorBuilder: (context, error, stackTrace) {
                    return const Center(child: Icon(Icons.edit, size: 40, color: Colors.grey));
                  },
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildSectionTitle(String title, IconData icon, {Color? color}) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      child: Row(
        children: [
          Icon(icon, size: 18, color: color ?? const Color(0xFF0B6E3A)),
          const SizedBox(width: 8),
          Text(
            title,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: color ?? const Color(0xFF0B6E3A),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoRow(String label, String value, IconData icon) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: Colors.grey.shade600),
          const SizedBox(width: 12),
          SizedBox(
            width: 120,
            child: Text(
              label,
              style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPhotoThumbnail(String url) {
    final fullUrl = _getFullUrl(url);
    
    return GestureDetector(
      onTap: () => _showPhotoDialog(fullUrl),
      child: Container(
        margin: const EdgeInsets.only(right: 8),
        width: 100,
        height: 100,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          color: Colors.grey.shade300,
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.network(
            fullUrl,
            fit: BoxFit.cover,
            loadingBuilder: (context, child, loadingProgress) {
              if (loadingProgress == null) return child;
              return const Center(child: CircularProgressIndicator());
            },
            errorBuilder: (context, error, stackTrace) {
              return const Center(
                child: Icon(Icons.broken_image, size: 40, color: Colors.grey),
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildVideoThumbnail(String url) {
  final fullUrl = _getFullUrl(url);
  
  return GestureDetector(
    onTap: () => _showVideoDialog(fullUrl),
    child: Container(
      margin: const EdgeInsets.only(right: 8),
      width: 100,
      height: 100,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        color: Colors.black,
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.network(
              fullUrl,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) {
                return Container(
                  color: Colors.grey.shade800,
                  child: const Icon(Icons.video_library, size: 40, color: Colors.white54),
                );
              },
            ),
          ),
          Container(
            decoration: BoxDecoration(
              color: Colors.black.withAlpha(50),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Center(
              child: Icon(
                Icons.play_circle_filled,
                size: 50,
                color: Colors.white,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

  String _getFullUrl(String url) {
    if (url.isEmpty) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('/uploads/')) {
      return 'http://localhost:8080$url';
    }
    return url;
  }

  void _showPhotoDialog(String url) {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        child: InteractiveViewer(
          minScale: 0.5,
          maxScale: 4.0,
          child: Image.network(
            url,
            fit: BoxFit.contain,
            errorBuilder: (context, error, stackTrace) {
              return const Center(
                child: Icon(Icons.broken_image, size: 100, color: Colors.grey),
              );
            },
          ),
        ),
      ),
    );
  }

  void _showVideoDialog(String url) {
  showDialog(
    context: context,
    builder: (context) => Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: double.infinity,
          height: MediaQuery.of(context).size.height * 0.5,
          color: Colors.black,
          child: VideoPlayerWidget(videoUrl: url),
        ),
      ),
    ),
  );
}

  Widget _buildOptionChip(String label, bool isActive, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: isActive ? color.withAlpha(25) : Colors.grey.withAlpha(25),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isActive ? color : Colors.grey,
          width: 0.5,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isActive ? Icons.check_circle : Icons.circle_outlined,
            size: 14,
            color: isActive ? color : Colors.grey,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: isActive ? color : Colors.grey,
            ),
          ),
        ],
      ),
    );
  }

  String _getDimensions() {
    final parts = <String>[];
    if (_parcel.length != null) parts.add('L: ${_parcel.length} cm');
    if (_parcel.width != null) parts.add('l: ${_parcel.width} cm');
    if (_parcel.height != null) parts.add('H: ${_parcel.height} cm');
    return parts.join(' x ');
  }

  String _getPaymentMethodLabel(dynamic method) {
    if (method == null) return 'Non spécifié';
    if (method is String) {
      switch (method) {
        case 'cash': return 'Espèces';
        case 'wave': return 'Wave';
        case 'orange_money': return 'Orange Money';
        case 'free_money': return 'Free Money';
        case 'card': return 'Carte bancaire';
        default: return method;
      }
    }
    final methodStr = method.toString();
    if (methodStr.contains('cash')) return 'Espèces';
    if (methodStr.contains('wave')) return 'Wave';
    if (methodStr.contains('orange')) return 'Orange Money';
    if (methodStr.contains('free')) return 'Free Money';
    if (methodStr.contains('card')) return 'Carte bancaire';
    return methodStr;
  }

  String _getPaymentStatusLabel(dynamic status) {
    if (status == null) return 'Non spécifié';
    if (status is String) {
      switch (status) {
        case 'pending': return 'En attente';
        case 'completed': return 'Payé';
        case 'paid': return 'Payé';
        case 'failed': return 'Échoué';
        case 'cancelled': return 'Annulé';
        default: return status;
      }
    }
    final statusStr = status.toString();
    if (statusStr.contains('pending')) return 'En attente';
    if (statusStr.contains('completed')) return 'Payé';
    if (statusStr.contains('paid')) return 'Payé';
    if (statusStr.contains('failed')) return 'Échoué';
    if (statusStr.contains('cancelled')) return 'Annulé';
    return statusStr;
  }

  Widget _buildStatusCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Statut actuel',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: _parcel.status.color.withAlpha(25),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Icon(
                    _parcel.isDelivered ? Icons.check_circle : Icons.local_shipping,
                    color: _parcel.status.color,
                    size: 32,
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _parcel.status.label,
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: _parcel.status.color,
                          ),
                        ),
                        Text(
                          _parcel.statusIcon,
                          style: const TextStyle(fontSize: 24),
                        ),
                        if (_parcel.deliveryDate != null)
                          Text(
                            'Livré le: ${_formatDate(_parcel.deliveryDate!)}',
                            style: const TextStyle(fontSize: 12, color: Colors.grey),
                          ),
                        if (_parcel.estimatedDeliveryDate != null)
                          Text(
                            'Livraison estimée: ${_formatDate(_parcel.estimatedDeliveryDate!)}',
                            style: const TextStyle(fontSize: 12, color: Colors.grey),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTimelineSection() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Historique du colis',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            if (_isLoadingEvents)
              const Center(child: CircularProgressIndicator())
            else if (_events.isEmpty)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(32),
                  child: Text('Aucun historique disponible'),
                ),
              )
            else
              StatusTimeline(events: _events),
          ],
        ),
      ),
    );
  }

  Widget _buildActionsSection() {
    List<Widget> actions = [];

    if (_parcel.status == ParcelStatus.pending || _parcel.status == ParcelStatus.confirmed) {
      actions.add(
        _buildActionButton(
          icon: Icons.check_circle,
          label: 'Accepter le colis',
          color: Colors.green,
          onPressed: _acceptParcel,
        ),
      );
    }
    
    if (_parcel.status == ParcelStatus.pickedUp) {
      actions.add(
        _buildActionButton(
          icon: Icons.directions_car,
          label: 'Démarrer le transport',
          color: Colors.blue,
          onPressed: () => _updateStatus('in_transit'),
        ),
      );
    }
    
    if (_parcel.status == ParcelStatus.inTransit) {
      actions.add(
        _buildActionButton(
          icon: Icons.location_on,
          label: 'Arrivé au garage',
          color: Colors.orange,
          onPressed: () => _updateStatus('arrived'),
        ),
      );
    }
    
    if (_parcel.status == ParcelStatus.arrived) {
      actions.add(
        _buildActionButton(
          icon: Icons.delivery_dining,
          label: 'Partir en livraison',
          color: Colors.purple,
          onPressed: () => _updateStatus('out_for_delivery'),
        ),
      );
    }
    
    if (_parcel.status == ParcelStatus.outForDelivery) {
      actions.add(
        _buildActionButton(
          icon: Icons.check_circle,
          label: 'Marquer comme livré',
          color: Colors.green,
          onPressed: _confirmDelivery,
        ),
      );
    }

    if (actions.isEmpty) return const SizedBox.shrink();

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Actions',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            ...actions,
          ],
        ),
      ),
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onPressed,
  }) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: _isUpdating ? null : onPressed,
        icon: Icon(icon, size: 20),
        label: Text(label),
        style: ElevatedButton.styleFrom(
          backgroundColor: color,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
    );
  }

  String _formatDate(DateTime? date) {
    if (date == null) return 'Non défini';
    return '${date.day}/${date.month}/${date.year} à ${date.hour}:${date.minute.toString().padLeft(2, '0')}';
  }
}